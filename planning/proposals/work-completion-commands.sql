-- Unregistered Phase6 construction. Complete actual Mobile work atomically;
-- retain accepted prices, independent outreach evidence and pending finance.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.calculate_completed_scope(uuid,uuid,jsonb,jsonb,uuid)') IS NULL
  OR to_regclass('crest.work_scope_outcomes') IS NOT NULL
  OR EXISTS(SELECT 1 FROM (VALUES
   ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'c7f6b92b673a1f7441490b46ee29baefb58037f9405b451754d0e54d1c4e2564'),
   ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'1e7f0cbaf8248c12ce596f88bc108ba4cc63874f988e3307a93729cb34a5b800'),
   ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'fe965adc6fe02d42d1955daff19dfd7f1ddc3fe63406f655dd8d64c29086130a'),
   ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'0fe228bc9625b8e05710c773ec2e098d2dce6065b5c26ba995303344932df799'),
   ('crest_private.check_booking_schedule_event()','crest_booking_integrity_owner',true,'a6d6ebd7ffec5adcd07e18611fe1fc69f72c84cdc7a01e278c1688a620b03f76'),
   ('crest_private.check_booking_plan()','crest_booking_integrity_owner',true,'c5c5fecccd1436b2be1597fa5310f8f58563239be4309a1a45abdc0e2c75f9af'),
   ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'e827568ac64b734a25441646237896745772b65843b2a42bf21eb58d5634ebad')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner
   WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner') AND a.grantee<>r.oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_WRITE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.work_scope_outcomes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,
 assigned_part_id uuid NOT NULL,completion_part_id uuid NOT NULL,partition_id uuid NOT NULL,outcome text NOT NULL CHECK(outcome IN('completed','unfulfilled','cancelled')),
 scope_description text NOT NULL CHECK(char_length(scope_description)>=1 AND char_length(scope_description)<=2000 AND btrim(scope_description,E' \t\n\r')<>''),completed_cents bigint NOT NULL CHECK(completed_cents>=0),reason text,
 CHECK(outcome='completed' OR completed_cents=0 AND reason IS NOT NULL),UNIQUE(business_id,completion_part_id),UNIQUE(business_id,job_id,partition_id),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),FOREIGN KEY(business_id,assigned_part_id) REFERENCES crest.allocation_plan_parts(business_id,id),FOREIGN KEY(business_id,completion_part_id) REFERENCES crest.allocation_plan_parts(business_id,id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.message_templates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),purpose text NOT NULL CHECK(purpose IN('review_request','mobile_arrival_eta')),sequence bigint NOT NULL CHECK(sequence>0),body_template text NOT NULL CHECK(char_length(body_template) BETWEEN 1 AND 10000),active boolean NOT NULL,reason text,
 UNIQUE(business_id,purpose,sequence),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.review_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,customer_id uuid NOT NULL,is_primary boolean NOT NULL DEFAULT true,message_id uuid,
 state text NOT NULL CHECK(state IN('prepared','pending','skipped')),suppression_reason text CHECK(suppression_reason IN('owner_skipped','outreach_opt_out','no_contact','missing_review_url','contact_review_required','duplicate_encounter','template_disabled')),reason text,additional_request_reason text,duplicate_count bigint NOT NULL CHECK(duplicate_count>=0),customer_version bigint NOT NULL CHECK(customer_version>0),
 CHECK((state='prepared')=(message_id IS NOT NULL)),CHECK(state='prepared' AND suppression_reason IS NULL OR state<>'prepared' AND suppression_reason IS NOT NULL),
 FOREIGN KEY(business_id,job_id,customer_id) REFERENCES crest.jobs(business_id,id,customer_id),UNIQUE(business_id,id,job_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE UNIQUE INDEX review_one_primary_per_job ON crest.review_requests(business_id,job_id,customer_id) WHERE is_primary;
CREATE TABLE crest.messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,customer_id uuid NOT NULL,request_id uuid NOT NULL,template_version_id uuid NOT NULL,purpose text NOT NULL CHECK(purpose='review_request'),state text NOT NULL CHECK(state='prepared'),channel text NOT NULL CHECK(channel IN('text','email')),recipient_snapshot jsonb NOT NULL CHECK(jsonb_typeof(recipient_snapshot)='object'),body_snapshot text NOT NULL CHECK(char_length(body_snapshot) BETWEEN 1 AND 10000),reason text,
 FOREIGN KEY(business_id,job_id,customer_id) REFERENCES crest.jobs(business_id,id,customer_id),FOREIGN KEY(business_id,request_id,job_id) REFERENCES crest.review_requests(business_id,id,job_id),FOREIGN KEY(business_id,template_version_id) REFERENCES crest.message_templates(business_id,id),UNIQUE(business_id,id,job_id),UNIQUE(business_id,request_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.review_requests ADD CONSTRAINT review_initial_message FOREIGN KEY(business_id,message_id,job_id) REFERENCES crest.messages(business_id,id,job_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE crest.message_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,message_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('prepared','opened','owner_confirmed_sent','failed','skipped')),effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)),reason text,
 FOREIGN KEY(business_id,message_id,job_id) REFERENCES crest.messages(business_id,id,job_id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.review_request_encounters(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,request_id uuid NOT NULL,job_encounter_id uuid NOT NULL,reason text,
 FOREIGN KEY(business_id,request_id,job_id) REFERENCES crest.review_requests(business_id,id,job_id),FOREIGN KEY(business_id,job_encounter_id) REFERENCES crest.job_encounters(business_id,id),UNIQUE(business_id,request_id,job_encounter_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.job_finalization_tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('invoice_finalization','commercial_resolution')),state text NOT NULL DEFAULT 'open' CHECK(state='open'),reason text,
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),UNIQUE(business_id,job_id,kind),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE FUNCTION crest_private.completion_projection(kind text,row_value jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $projection$
BEGIN
 IF kind NOT IN('work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks') THEN RAISE EXCEPTION 'CREST_COMPLETION_SOURCE_REQUIRED';END IF;
 row_value:=row_value||jsonb_build_object('created_at',to_char((row_value->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 IF kind='work_scope_outcomes' THEN row_value:=row_value||jsonb_build_object('completed_cents',row_value->>'completed_cents');END IF;
 IF kind='message_templates' THEN row_value:=row_value||jsonb_build_object('sequence',row_value->>'sequence');END IF;
 IF kind='review_requests' THEN row_value:=row_value||jsonb_build_object('customer_version',row_value->>'customer_version','duplicate_count',row_value->>'duplicate_count');END IF;
 IF kind='message_events' THEN row_value:=row_value||jsonb_build_object('effective_at',to_char((row_value->>'effective_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));END IF;RETURN row_value;
END $projection$;
CREATE FUNCTION crest_private.stamp_completion_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stamp$
BEGIN
 IF NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.created_by IS DISTINCT FROM nullif(current_setting('crest.actor_id',true),'')::uuid OR NEW.operation_id IS DISTINCT FROM nullif(current_setting('crest.operation_id',true),'')::uuid OR NEW.origin<>'manual'
  OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by AND command_type='operations.job.complete' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_CONTEXT_REQUIRED';END IF;NEW.created_at:=clock_timestamp();RETURN NEW;
END $stamp$;
CREATE FUNCTION crest_private.check_completion_source_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=NEW.id AND a.entity_version=1 AND a.action='create' AND a.delta=jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.completion_projection(TG_TABLE_NAME,to_jsonb(NEW))) AND a.origin='manual' AND a.import_row_id IS NULL AND o.command_type='operations.job.complete' AND o.schema_version=1 AND o.state='committed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_AUDIT_REQUIRED';END IF;RETURN NULL;
END $audit$;
DO $tables$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE crest.%I ADD CONSTRAINT completion_created_finite CHECK(isfinite(created_at))',name);
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_booking_owner',name);EXECUTE format('GRANT SELECT ON crest.%I TO crest_booking_integrity_owner',name);EXECUTE format('GRANT USAGE ON TYPE crest.%I TO crest_booking_owner,crest_booking_integrity_owner',name);
  EXECUTE format('CREATE POLICY completion_read ON crest.%I FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY completion_insert ON crest.%I FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND created_by=nullif(current_setting(''crest.actor_id'',true),'''')::uuid AND operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY completion_integrity ON crest.%I FOR SELECT TO crest_booking_integrity_owner USING(true)',name);
  EXECUTE format('CREATE TRIGGER completion_stamp BEFORE INSERT ON crest.%I FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_completion_source()',name);
  EXECUTE format('CREATE CONSTRAINT TRIGGER completion_audit AFTER INSERT ON crest.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_completion_source_audit()',name);
  EXECUTE format('CREATE TRIGGER completion_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source()',name);
  EXECUTE format('CREATE INDEX %I ON crest.%I(business_id,operation_id,created_by)',name||'_operation',name);EXECUTE format('CREATE INDEX %I ON crest.%I(business_id,created_by)',name||'_actor',name);EXECUTE format('CREATE INDEX %I ON crest.%I(business_id,created_at,id)',name||'_timeline',name);
  IF name<>'message_templates' THEN EXECUTE format('CREATE INDEX %I ON crest.%I(business_id,job_id)',name||'_job',name);END IF;
 END LOOP;
END $tables$;
CREATE INDEX work_outcome_assigned ON crest.work_scope_outcomes(business_id,assigned_part_id);
CREATE INDEX review_customer ON crest.review_requests(business_id,customer_id);
CREATE INDEX messages_customer ON crest.messages(business_id,customer_id);
CREATE INDEX messages_template ON crest.messages(business_id,template_version_id);
CREATE INDEX message_event_parent ON crest.message_events(business_id,message_id);
CREATE INDEX review_encounter_parent ON crest.review_request_encounters(business_id,job_encounter_id);
GRANT UPDATE(completed_at,completion_outcome) ON crest.jobs TO crest_booking_owner;
CREATE POLICY completion_jobs_update ON crest.jobs FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='completed' AND first_work_at IS NOT NULL AND completed_at IS NOT NULL AND completion_outcome IS NOT NULL);
CREATE POLICY completion_operations_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.complete');
CREATE POLICY completion_operations_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.job.complete' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY completion_operations_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.complete') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.complete');
CREATE POLICY completion_integrity_operations ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type='operations.job.complete');
CREATE POLICY completion_audits_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND entity_kind IN('work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'));
CREATE POLICY completion_audits_create ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL AND entity_kind IN('work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'));
CREATE POLICY completion_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner USING(entity_kind IN('work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'));
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.stamp_completion_source() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_completion_source_audit() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.stamp_completion_source(),crest_private.check_completion_source_audit(),crest_private.completion_projection(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.completion_projection(text,jsonb) TO crest_booking_owner,crest_booking_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE INDEX review_message_parent ON crest.review_requests(business_id,message_id);
ALTER TABLE crest.review_requests ADD COLUMN recipient_snapshot jsonb NOT NULL CHECK(jsonb_typeof(recipient_snapshot)='object');
CREATE POLICY completion_integrity_all_audits ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner USING(EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id AND o.command_type='operations.job.complete'));
CREATE FUNCTION crest_private.valid_completion_body(body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $body$
DECLARE w jsonb;r jsonb;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['scope','walkthrough','reason','review']<>'{}'::jsonb OR NOT body ?& ARRAY['scope','walkthrough','reason','review'] OR octet_length(body::text)>1048576 OR jsonb_typeof(body->'scope') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'scope')=0 OR NOT coalesce(body->'reason'='null'::jsonb OR crest_private.booking_text_required(body->'reason',1000),false) THEN RETURN false;END IF;
 w:=body->'walkthrough';r:=body->'review';
 IF jsonb_typeof(w) IS DISTINCT FROM 'object' OR w-ARRAY['state','reason']<>'{}'::jsonb OR NOT w ?& ARRAY['state','reason'] OR w->>'state' IS NULL OR w->>'state' NOT IN('done','unavailable') OR NOT coalesce(w->'reason'='null'::jsonb AND w->>'state'='done' OR crest_private.booking_text_required(w->'reason',1000),false) THEN RETURN false;END IF;
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['reviewUrl','skipReason','additionalRequestReason','expectedDuplicateRequestIds','expectedCustomerVersion','contactReviewReason']<>'{}'::jsonb OR NOT r ?& ARRAY['reviewUrl','skipReason','additionalRequestReason','expectedDuplicateRequestIds','expectedCustomerVersion','contactReviewReason'] OR jsonb_typeof(r->'expectedDuplicateRequestIds') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'expectedCustomerVersion') IS DISTINCT FROM 'string' OR (r->>'expectedCustomerVersion')!~'^[1-9][0-9]{0,18}$' OR (r->>'expectedCustomerVersion')::numeric>9223372036854775807 THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'expectedDuplicateRequestIds') value WHERE crest_private.booking_uuid(value) IS NOT TRUE) OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(r->'expectedDuplicateRequestIds'))<>jsonb_array_length(r->'expectedDuplicateRequestIds') THEN RETURN false;END IF;
 IF NOT coalesce(r->'skipReason'='null'::jsonb OR crest_private.booking_text_required(r->'skipReason',1000),false) OR NOT coalesce(r->'additionalRequestReason'='null'::jsonb OR crest_private.booking_text_required(r->'additionalRequestReason',1000),false) OR NOT coalesce(r->'contactReviewReason'='null'::jsonb OR crest_private.booking_text_required(r->'contactReviewReason',1000),false) THEN RETURN false;END IF;
 RETURN r->'reviewUrl'='null'::jsonb OR jsonb_typeof(r->'reviewUrl')='string' AND char_length(r->>'reviewUrl')<=2048;
END $body$;
CREATE FUNCTION crest_private.completion_review_details(business uuid,job uuid,review jsonb,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE j crest.jobs;c crest.customers;a crest.appointments;duplicates jsonb;observed jsonb;suppressed text;note text;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO c FROM crest.customers WHERE business_id=business AND id=j.customer_id;SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=j.current_appointment_id;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO duplicates FROM(SELECT DISTINCT r.id FROM crest.review_requests r JOIN crest.review_request_encounters b ON b.business_id=r.business_id AND b.request_id=r.id JOIN crest.job_encounters old_encounter ON old_encounter.business_id=b.business_id AND old_encounter.id=b.job_encounter_id JOIN crest.job_encounters encounter ON encounter.business_id=old_encounter.business_id AND encounter.encounter_id=old_encounter.encounter_id WHERE r.business_id=business AND r.customer_id=j.customer_id AND r.job_id<>job AND encounter.job_id=job AND r.operation_id<>operation) previous;
 SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO observed FROM jsonb_array_elements(review->'expectedDuplicateRequestIds') value;
 IF review->'skipReason'<>'null'::jsonb THEN suppressed:='owner_skipped';note:=review->>'skipReason';
 ELSIF c.outreach_opt_out THEN suppressed:='outreach_opt_out';note:='Customer outreach is opted out';
 ELSIF a.contact_snapshot->>'kind'='no_contact' THEN suppressed:='no_contact';note:=a.contact_snapshot->>'reason';
 ELSIF review->'reviewUrl'='null'::jsonb OR (review->>'reviewUrl')!~'^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' THEN suppressed:='missing_review_url';note:='A valid HTTPS review link is not configured';
 ELSIF review->>'expectedCustomerVersion' IS DISTINCT FROM c.version::text OR c.contact_preference IS NOT NULL AND review->'contactReviewReason'='null'::jsonb THEN suppressed:='contact_review_required';note:='Review current customer contact preferences';
 ELSIF duplicates<>'[]'::jsonb AND(observed IS DISTINCT FROM duplicates OR review->'additionalRequestReason'='null'::jsonb) THEN suppressed:='duplicate_encounter';note:='An encounter already has a review request; explicit additional-request review is required';END IF;
 RETURN jsonb_build_object('state',CASE WHEN suppressed IS NULL THEN 'prepared' WHEN suppressed IN('owner_skipped','outreach_opt_out') THEN 'skipped' ELSE 'pending' END,'suppressionReason',suppressed,'reason',note,'duplicateIds',duplicates,'customerVersion',c.version::text,'recipientSnapshot',a.contact_snapshot);
END $review$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.completion_review_details(uuid,uuid,jsonb,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.valid_completion_body(jsonb),crest_private.completion_review_details(uuid,uuid,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_completion_body(jsonb),crest_private.completion_review_details(uuid,uuid,jsonb,uuid) TO crest_booking_owner,crest_booking_integrity_owner;
-- Deferred completion verification reuses the same pure input validators as
-- the command. The closed verifier receives execution; ordinary roles do not.
GRANT EXECUTE ON FUNCTION crest_private.booking_uuid(jsonb),crest_private.booking_text_required(jsonb,integer) TO crest_booking_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.check_completed_job_graph(business uuid,job uuid,operation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $graph$
DECLARE j crest.jobs;e crest.job_events;before_job jsonb;after_job jsonb;body jsonb;expected jsonb;entry jsonb;p crest.allocation_plan_versions;actual jsonb;old_ids uuid[];w crest.work_intervals;previous crest.work_intervals;r crest.review_requests;m crest.messages;t crest.message_templates;review jsonb;counted bigint;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO e FROM crest.job_events WHERE business_id=business AND job_id=job AND sequence=j.version;
 SELECT delta->'before',delta->'after' INTO before_job,after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='jobs' AND entity_id=job AND entity_version=j.version;
 body:=e.evidence->'request'->'body';
 IF j.id IS NULL OR j.operation_id IS DISTINCT FROM operation OR e.id IS NULL OR e.operation_id<>operation OR (SELECT count(*) FROM crest.job_events WHERE business_id=business AND operation_id=operation)<>1 OR e.created_by<>j.updated_by OR e.from_state NOT IN('in_progress','paused') OR e.to_state<>'completed' OR j.state<>'completed' OR j.fulfillment_mode<>'mobile'
  OR before_job IS NULL OR e.from_state IS DISTINCT FROM before_job->>'state' OR after_job IS DISTINCT FROM crest_private.jobs_projection(j) OR (before_job->>'version')::bigint+1<>j.version
  OR before_job-ARRAY['state','version','completed_at','completion_outcome','updated_at','updated_by','operation_id'] IS DISTINCT FROM after_job-ARRAY['state','version','completed_at','completion_outcome','updated_at','updated_by','operation_id']
  OR j.first_work_at IS NULL OR j.completed_at<>e.effective_at OR e.effective_at>e.created_at OR e.reason IS DISTINCT FROM body->>'reason' OR crest_private.valid_completion_body(body) IS NOT TRUE
  OR e.evidence->'request' IS DISTINCT FROM jsonb_build_object('commandType','operations.job.complete','schemaVersion',1,'businessId',business,'actorId',j.updated_by,'recoveryEpoch',(SELECT recovery_epoch FROM crest_private.operations WHERE business_id=business AND operation_id=operation),'jobId',job,'expectedVersion',(j.version-1)::text,'body',body)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_JOB_GRAPH_REQUIRED';END IF;
 SELECT * INTO w FROM crest.work_intervals WHERE business_id=business AND id=(e.evidence->>'closedWorkIntervalId')::uuid;SELECT * INTO previous FROM crest.work_intervals WHERE business_id=business AND id=w.replaces_id;
 IF w.id IS NULL OR previous.id IS NULL OR w.job_id<>job OR w.operation_id<>operation OR w.change_kind<>'close' OR w.ended_at<>j.completed_at OR previous.ended_at IS NOT NULL OR w.kind IS DISTINCT FROM(CASE e.from_state WHEN 'paused' THEN 'pause' ELSE 'active' END)
  OR EXISTS(SELECT 1 FROM crest.current_work_intervals WHERE business_id=business AND job_id=job AND ended_at IS NULL) OR (SELECT count(*) FROM crest.work_intervals WHERE business_id=business AND operation_id=operation)<>1 OR EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=business AND operation_id=operation)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_TIME_REQUIRED';END IF;
 SELECT array_agg(replaces_id ORDER BY source_allocation_id),count(*) INTO old_ids,counted FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation;
 IF counted=0 OR (SELECT count(DISTINCT source_allocation_id) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation)<>counted OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state='assigned') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_REQUIRED';END IF;
 expected:=crest_private.calculate_completed_scope(business,job,crest_private.load_completion_plans(business,job,old_ids),body->'scope',operation);
 IF expected IS DISTINCT FROM e.evidence->'scopePlan' OR expected->>'completionOutcome' IS DISTINCT FROM j.completion_outcome OR jsonb_array_length(expected->'plans')<>counted THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_REQUIRED';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(expected->'plans') LOOP
  SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND source_allocation_id=(entry->>'sourceAllocationId')::uuid;
  SELECT jsonb_agg(jsonb_build_object('partitionId',stable_partition_id,'jobId',job_id,'state',allocation_state,'grossInclusiveCents',gross_inclusive_cents::text,'discountInclusiveCents',discount_inclusive_cents::text,'amountCents',amount_cents::text,'scopeDescription',scope_description) ORDER BY stable_partition_id) INTO actual FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id;
  IF p.replaces_id::text IS DISTINCT FROM entry->>'expectedPlanId' OR p.sequence<>(entry->>'expectedPlanSequence')::bigint+1 OR actual IS DISTINCT FROM(SELECT jsonb_agg(value ORDER BY value->>'partitionId') FROM jsonb_array_elements(entry->'parts')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_REQUIRED';END IF;
 END LOOP;
 IF (SELECT count(*) FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation)<>jsonb_array_length(expected->'outcomes') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_OUTCOMES_REQUIRED';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(expected->'outcomes') LOOP
  IF NOT EXISTS(SELECT 1 FROM crest.work_scope_outcomes o JOIN crest.allocation_plan_parts part ON part.business_id=o.business_id AND part.id=o.completion_part_id JOIN crest.allocation_plan_versions plan ON plan.business_id=part.business_id AND plan.id=part.plan_id WHERE o.business_id=business AND o.operation_id=operation AND o.job_id=job AND o.assigned_part_id::text=entry->>'assignedPartId' AND o.partition_id::text=entry->>'partitionId' AND o.outcome=entry->>'outcome' AND o.completed_cents::text=entry->>'completedCents' AND o.scope_description=entry->>'scopeDescription' AND o.reason IS NOT DISTINCT FROM entry->>'reason' AND part.stable_partition_id=o.partition_id AND part.job_id=job AND plan.operation_id=operation AND part.operation_id=operation)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_OUTCOMES_REQUIRED';END IF;
 END LOOP;
 SELECT * INTO r FROM crest.review_requests WHERE business_id=business AND operation_id=operation AND job_id=job;
 review:=crest_private.completion_review_details(business,job,body->'review',operation);
 IF r.id IS NULL OR NOT r.is_primary OR (SELECT count(*) FROM crest.review_requests WHERE business_id=business AND operation_id=operation)<>1 OR r.customer_id<>j.customer_id OR r.customer_version::text IS DISTINCT FROM review->>'customerVersion' OR r.duplicate_count<>jsonb_array_length(review->'duplicateIds') OR r.recipient_snapshot IS DISTINCT FROM review->'recipientSnapshot' OR r.additional_request_reason IS DISTINCT FROM body->'review'->>'additionalRequestReason'
  OR EXISTS(SELECT 1 FROM crest.review_request_encounters b JOIN crest.job_encounters encounter ON encounter.business_id=b.business_id AND encounter.id=b.job_encounter_id WHERE b.business_id=business AND b.request_id=r.id AND(encounter.job_id<>job OR b.operation_id<>operation OR b.job_id<>job))
  OR (SELECT count(*) FROM crest.review_request_encounters WHERE business_id=business AND request_id=r.id)<>(SELECT count(*) FROM crest.job_encounters WHERE business_id=business AND job_id=job) OR EXISTS(SELECT 1 FROM crest.review_request_encounters WHERE business_id=business AND operation_id=operation AND(request_id<>r.id OR job_id<>job))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 IF r.message_id IS NULL THEN
  IF review->>'state'='prepared' THEN SELECT * INTO t FROM crest.message_templates WHERE business_id=business AND purpose='review_request' ORDER BY sequence DESC LIMIT 1;IF t.id IS NOT NULL AND NOT t.active THEN review:=review||jsonb_build_object('state','pending','suppressionReason','template_disabled','reason','Review template is disabled');END IF;END IF;
  IF r.state IS DISTINCT FROM review->>'state' OR r.suppression_reason IS DISTINCT FROM review->>'suppressionReason' OR r.reason IS DISTINCT FROM review->>'reason' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 ELSE
  SELECT * INTO m FROM crest.messages WHERE business_id=business AND id=r.message_id;SELECT * INTO t FROM crest.message_templates WHERE business_id=business AND id=m.template_version_id;
  IF review->>'state'<>'prepared' OR r.state<>'prepared' OR r.suppression_reason IS NOT NULL OR m.id IS NULL OR m.operation_id<>operation OR m.request_id<>r.id OR m.job_id<>job OR m.customer_id<>j.customer_id OR m.state<>'prepared' OR m.recipient_snapshot IS DISTINCT FROM review->'recipientSnapshot' OR m.channel IS DISTINCT FROM(CASE m.recipient_snapshot->>'kind' WHEN 'phone' THEN 'text' ELSE 'email' END)
   OR t.id IS NULL OR t.purpose<>'review_request' OR NOT t.active OR m.body_snapshot IS DISTINCT FROM replace(t.body_template,'{review_url}',body->'review'->>'reviewUrl')
   OR NOT EXISTS(SELECT 1 FROM crest.message_events WHERE business_id=business AND message_id=m.id AND job_id=job AND operation_id=operation AND kind='prepared' AND effective_at=j.completed_at)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_MESSAGE_REQUIRED';END IF;
 END IF;
 IF (SELECT count(*) FROM crest.messages WHERE business_id=business AND operation_id=operation)<>(CASE WHEN r.message_id IS NULL THEN 0 ELSE 1 END) OR (SELECT count(*) FROM crest.message_events WHERE business_id=business AND operation_id=operation)<>(CASE WHEN r.message_id IS NULL THEN 0 ELSE 1 END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_MESSAGE_REQUIRED';END IF;
 IF (SELECT count(*) FROM crest.message_templates WHERE business_id=business AND operation_id=operation)>1 OR EXISTS(SELECT 1 FROM crest.message_templates WHERE business_id=business AND operation_id=operation AND(purpose<>'review_request' OR sequence<>1 OR NOT active OR body_template<>'Thank you for choosing Crest Detailing. We would appreciate an honest review: {review_url}' OR r.message_id IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_TEMPLATE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest.job_finalization_tasks WHERE business_id=business AND job_id=job AND operation_id=operation AND kind='invoice_finalization' AND state='open')
  OR (SELECT count(*) FROM crest.job_finalization_tasks WHERE business_id=business AND operation_id=operation)<>(CASE WHEN j.completion_outcome='partial' THEN 2 ELSE 1 END)
  OR (j.completion_outcome='partial') IS DISTINCT FROM EXISTS(SELECT 1 FROM crest.job_finalization_tasks WHERE business_id=business AND job_id=job AND operation_id=operation AND kind='commercial_resolution' AND state='open')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_FINALIZATION_REQUIRED';END IF;
END $graph$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_completed_job_graph(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_completed_job_graph(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_completed_job_graph(uuid,uuid,uuid) TO crest_booking_owner;

-- Exact measured predecessor branches; old booking/field paths stay intact.
DO $extend$ DECLARE definition text;updated text;BEGIN
 definition:=pg_get_functiondef('crest_private.authorize_booking_statement()'::regprocedure);
 updated:=replace(definition,'IF NOT coalesce(kind=''operations.job.field''','IF NOT coalesce(kind=''operations.job.complete'' AND(TG_OP=''UPDATE'' AND TG_TABLE_NAME=''jobs'' OR TG_OP=''INSERT'' AND TG_TABLE_NAME IN(''job_events'',''allocation_plan_versions'',''allocation_plan_parts'')) OR kind=''operations.job.field''');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_booking_row()'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.field'' THEN',$branch$
 IF kind='operations.job.complete' THEN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' THEN
   IF OLD.state NOT IN('in_progress','paused') OR NEW.state<>'completed' OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR NEW.completed_at IS NULL OR NEW.completed_at<OLD.first_work_at OR NEW.completion_outcome NOT IN('full','partial')
    OR to_jsonb(NEW)-ARRAY['state','version','updated_at','updated_by','operation_id','completed_at','completion_outcome'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','version','updated_at','updated_by','operation_id','completed_at','completion_outcome'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_JOB_GRAPH_REQUIRED';END IF;
   NEW.updated_at:=stamp;RETURN NEW;
  ELSIF TG_OP='INSERT' AND TG_TABLE_NAME IN('job_events','allocation_plan_versions','allocation_plan_parts') AND NEW.created_by=actor THEN NEW.created_at:=stamp;RETURN NEW;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_SOURCE_REQUIRED';END IF;
 END IF;
 IF kind='operations.job.field' THEN$branch$);
 updated:=replace(updated,'''quote.amendment.accept'',''operations.job.field'')','''quote.amendment.accept'',''operations.job.field'',''operations.job.complete'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 updated:=replace(definition,'o.command_type=''operations.job.field'' AND TG_TABLE_NAME IN(''jobs'',''job_events'')','(o.command_type=''operations.job.field'' AND TG_TABLE_NAME IN(''jobs'',''job_events'') OR o.command_type=''operations.job.complete'' AND TG_TABLE_NAME IN(''jobs'',''job_events'',''allocation_plan_versions'',''allocation_plan_parts''))');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_job_graph(uuid,uuid,uuid)'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.field'' THEN','IF kind=''operations.job.complete'' THEN PERFORM crest_private.check_completed_job_graph(business,job,source_operation);RETURN;END IF; IF kind=''operations.job.field'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_schedule_event()'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.field'' THEN','IF kind=''operations.job.complete'' THEN PERFORM crest_private.check_completed_job_graph(NEW.business_id,NEW.job_id,NEW.operation_id);RETURN NULL;END IF; IF kind=''operations.job.field'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_plan()'::regprocedure);
 updated:=replace(definition,'DECLARE p crest.allocation_plan_versions;','DECLARE completion_job uuid;p crest.allocation_plan_versions;');
 updated:=replace(updated,'kind NOT IN(''operations.job.book'',''operations.job.cancel'')','kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'')');
 updated:=replace(updated,'-- Existing assigned work stays intact when booking another visit;', $branch$
 IF kind='operations.job.complete' THEN
  SELECT job_id INTO completion_job FROM crest.job_events WHERE business_id=p.business_id AND operation_id=p.operation_id;
  IF completion_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_REQUIRED';END IF;
  PERFORM crest_private.check_completed_job_graph(p.business_id,completion_job,p.operation_id);RETURN NULL;
 END IF;
 -- Existing assigned work stays intact when booking another visit;$branch$);
 IF updated=definition OR position('DECLARE completion_job uuid;' IN updated)=0 THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 updated:=replace(definition,'''operations.travel.record'',''operations.time.correct'')','''operations.travel.record'',''operations.time.correct'',''operations.job.complete'')');
 updated:=replace(updated,'PERFORM crest_private.lock_booking_operator(NEW.business_id,NEW.operator_actor_id);', 'IF command=''operations.job.complete'' AND (TG_TABLE_NAME<>''work_intervals'' OR NEW.change_kind<>''close'') THEN RAISE EXCEPTION USING ERRCODE=''42501'',MESSAGE=''CREST_COMPLETION_TIME_REQUIRED'';END IF; PERFORM crest_private.lock_booking_operator(NEW.business_id,NEW.operator_actor_id);');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.append_completion_audit(kind text,row_value jsonb) RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE result uuid;
BEGIN
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES((row_value->>'business_id')::uuid,(row_value->>'operation_id')::uuid,(row_value->>'created_by')::uuid,(row_value->>'created_by')::uuid,kind,(row_value->>'id')::uuid,1,'create',row_value->>'reason',jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.completion_projection(kind,row_value)),'manual') RETURNING id INTO result;RETURN result;
END $audit$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.append_completion_audit(text,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.append_completion_audit(text,jsonb) FROM PUBLIC;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.completed_job_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.job_events;r jsonb;audits jsonb;saved_job jsonb;actual_ids jsonb;kind text;expected_count bigint;actual_count bigint;
BEGIN
 SELECT state,schema_version,result_schema_version,result,payload_hash,recovery_epoch INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.complete';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO e FROM crest.job_events WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT delta->'after' INTO saved_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='jobs' AND entity_id=e.job_id AND entity_version=e.sequence;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 r:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.complete','businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'jobVersion',e.sequence::text,'completedAt',saved_job->>'completed_at','completionOutcome',saved_job->>'completion_outcome','closedWorkIntervalId',e.evidence->'closedWorkIntervalId','allocationPlanIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation),'outcomeIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation),'reviewRequestId',(SELECT id FROM crest.review_requests WHERE business_id=business AND operation_id=operation),'messageId',(SELECT message_id FROM crest.review_requests WHERE business_id=business AND operation_id=operation),'finalizationTaskIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.job_finalization_tasks WHERE business_id=business AND operation_id=operation),'auditIds',audits);
 IF e.id IS NULL OR r IS NULL OR saved_job IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM r OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to((e.evidence->'request')::text,'UTF8')),'hex')
  OR r->>'businessId' IS DISTINCT FROM business::text OR r->>'actorId' IS DISTINCT FROM actor::text OR r->>'operationId' IS DISTINCT FROM operation::text OR r->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR r->>'jobId' IS DISTINCT FROM e.job_id::text OR r->>'jobVersion' IS DISTINCT FROM e.sequence::text OR r->>'commandType' IS DISTINCT FROM 'operations.job.complete' OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->'auditIds' IS DISTINCT FROM audits
  OR saved_job->>'state'<>'completed' OR r->>'completedAt' IS DISTINCT FROM saved_job->>'completed_at' OR r->>'completionOutcome' IS DISTINCT FROM saved_job->>'completion_outcome'
  OR NOT EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=business AND operation_id=operation AND id=(r->>'closedWorkIntervalId')::uuid AND ended_at=e.effective_at AND change_kind='close')
  OR NOT EXISTS(SELECT 1 FROM crest.review_requests WHERE business_id=business AND operation_id=operation AND id=(r->>'reviewRequestId')::uuid AND job_id=e.job_id AND message_id IS NOT DISTINCT FROM(r->>'messageId')::uuid)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO actual_ids FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation;IF actual_ids IS DISTINCT FROM r->'allocationPlanIds' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO actual_ids FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation;IF actual_ids IS DISTINCT FROM r->'outcomeIds' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO actual_ids FROM crest.job_finalization_tasks WHERE business_id=business AND operation_id=operation;IF actual_ids IS DISTINCT FROM r->'finalizationTaskIds' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 -- Every audit is one real source row, including the two mutable/event parents.
 expected_count:=3;FOREACH kind IN ARRAY ARRAY['allocation_plan_versions','allocation_plan_parts','work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'] LOOP EXECUTE format('SELECT count(*) FROM crest.%I WHERE business_id=$1 AND operation_id=$2',kind) INTO actual_count USING business,operation;expected_count:=expected_count+actual_count;END LOOP;
 IF jsonb_array_length(audits)<>expected_count OR EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind NOT IN('jobs','job_events','work_intervals','allocation_plan_versions','allocation_plan_parts','work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',r);
END $result$;
CREATE FUNCTION crest_private.check_completed_job_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $guard$
BEGIN IF crest_private.completed_job_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;RETURN NULL;END $guard$;
CREATE CONSTRAINT TRIGGER completed_job_result AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.job.complete') EXECUTE FUNCTION crest_private.check_completed_job_result();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.completed_job_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_completed_job_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.completed_job_result(uuid,uuid,uuid),crest_private.check_completed_job_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.completed_job_result(uuid,uuid,uuid) TO crest_booking_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.complete_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $complete$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing crest_private.operations;j crest.jobs;before_job jsonb;old_work crest.work_intervals;closed_work crest.work_intervals;scope_plan jsonb;plan_entry jsonb;piece jsonb;outcome jsonb;prior_plan crest.allocation_plan_versions;new_plan crest.allocation_plan_versions;part crest.allocation_plan_parts;scope_row crest.work_scope_outcomes;review_row crest.review_requests;template crest.message_templates;message crest.messages;message_event crest.message_events;binding crest.review_request_encounters;encounter crest.job_encounters;task crest.job_finalization_tasks;c crest.customers;event crest.job_events;review jsonb;stamp timestamptz;review_id uuid:=gen_random_uuid();message_id uuid;audits jsonb;receipt jsonb;result jsonb;reason text;family uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_version IS NULL OR expected_version<1 OR crest_private.valid_completion_body(body) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType','operations.job.complete','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedVersion',expected_version::text,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.complete',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.complete' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;result:=crest_private.completed_job_result(requested_business,expected_actor,requested_operation);
  ELSE
   -- The planner takes the canonical mode/family/operator locks and checks the
   -- actual source/version. Invalid scope never changes the terminal state.
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;
   IF j.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1901',MESSAGE='job';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,j.operator_actor_id);
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF j.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1901',MESSAGE='version';END IF;
   IF j.state NOT IN('in_progress','paused') OR j.fulfillment_mode<>'mobile' THEN RAISE EXCEPTION USING ERRCODE='P1901',MESSAGE='state';END IF;
   scope_plan:=crest_private.plan_completed_scope(requested_business,requested_job,expected_version,body->'scope');
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF j.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1901',MESSAGE='version';END IF;
   SELECT * INTO c FROM crest.customers WHERE business_id=requested_business AND id=j.customer_id FOR SHARE;
   stamp:=clock_timestamp();before_job:=crest_private.jobs_projection(j);
   SELECT * INTO old_work FROM crest.current_work_intervals WHERE business_id=requested_business AND job_id=requested_job AND ended_at IS NULL;
   IF old_work.id IS NULL OR old_work.kind IS DISTINCT FROM(CASE j.state WHEN 'paused' THEN 'pause' ELSE 'active' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_TIME_REQUIRED';END IF;
   INSERT INTO crest.work_intervals(business_id,logical_id,sequence,replaces_id,job_id,operator_actor_id,kind,started_at,ended_at,pause_reason,change_kind,created_by,operation_id) VALUES(requested_business,old_work.logical_id,old_work.sequence+1,old_work.id,j.id,j.operator_actor_id,old_work.kind,old_work.started_at,stamp,old_work.pause_reason,'close',expected_actor,requested_operation) RETURNING * INTO closed_work;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'work_intervals',closed_work.logical_id,closed_work.sequence,'close',jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(old_work),'after',crest_private.field_work_projection(closed_work)),'manual');
   UPDATE crest.jobs SET state='completed',completed_at=stamp,completion_outcome=scope_plan->>'completionOutcome',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;
   PERFORM crest_private.append_booking_audit('jobs',j.id,j.version,'revise',before_job,crest_private.jobs_projection(j));
   FOR plan_entry IN SELECT value FROM jsonb_array_elements(scope_plan->'plans') LOOP
    SELECT * INTO prior_plan FROM crest.allocation_plan_versions WHERE business_id=requested_business AND id=(plan_entry->>'expectedPlanId')::uuid;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,prior_plan.source_allocation_id,prior_plan.sequence+1,prior_plan.id,coalesce(body->>'reason','Recorded work completion'),expected_actor,requested_operation,prior_plan.entitlement_version_id,prior_plan.authorization_state) RETURNING * INTO new_plan;
    PERFORM crest_private.append_booking_audit('allocation_plan_versions',new_plan.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(new_plan));
    FOR piece IN SELECT value FROM jsonb_array_elements(plan_entry->'parts') LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,new_plan.id,(piece->>'partitionId')::uuid,(piece->>'jobId')::uuid,piece->>'state',(piece->>'grossInclusiveCents')::bigint,(piece->>'discountInclusiveCents')::bigint,(piece->>'amountCents')::bigint,piece->>'scopeDescription',expected_actor,requested_operation) RETURNING * INTO part;
     PERFORM crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part));
     IF part.job_id=j.id THEN
      SELECT value INTO outcome FROM jsonb_array_elements(scope_plan->'outcomes') value WHERE value->>'partitionId'=part.stable_partition_id::text;
      IF outcome IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_OUTCOMES_REQUIRED';END IF;
      INSERT INTO crest.work_scope_outcomes(business_id,job_id,assigned_part_id,completion_part_id,partition_id,outcome,scope_description,completed_cents,reason,created_by,operation_id) VALUES(requested_business,j.id,(outcome->>'assignedPartId')::uuid,part.id,part.stable_partition_id,outcome->>'outcome',outcome->>'scopeDescription',(outcome->>'completedCents')::bigint,outcome->>'reason',expected_actor,requested_operation) RETURNING * INTO scope_row;
      PERFORM crest_private.append_completion_audit('work_scope_outcomes',to_jsonb(scope_row));
     END IF;
    END LOOP;
   END LOOP;
   review:=crest_private.completion_review_details(requested_business,j.id,body->'review',requested_operation);
   IF review->>'state'='prepared' THEN
    SELECT * INTO template FROM crest.message_templates WHERE business_id=requested_business AND purpose='review_request' ORDER BY sequence DESC LIMIT 1;
    IF template.id IS NULL THEN
     INSERT INTO crest.message_templates(business_id,purpose,sequence,body_template,active,created_by,operation_id) VALUES(requested_business,'review_request',1,'Thank you for choosing Crest Detailing. We would appreciate an honest review: {review_url}',true,expected_actor,requested_operation) RETURNING * INTO template;PERFORM crest_private.append_completion_audit('message_templates',to_jsonb(template));
    END IF;
    IF NOT template.active THEN review:=review||jsonb_build_object('state','pending','suppressionReason','template_disabled','reason','Review template is disabled');ELSE message_id:=gen_random_uuid();END IF;
   END IF;
   INSERT INTO crest.review_requests(id,business_id,job_id,customer_id,is_primary,message_id,state,suppression_reason,reason,additional_request_reason,duplicate_count,customer_version,recipient_snapshot,created_by,operation_id) VALUES(review_id,requested_business,j.id,j.customer_id,true,message_id,review->>'state',review->>'suppressionReason',review->>'reason',body->'review'->>'additionalRequestReason',jsonb_array_length(review->'duplicateIds'),c.version,review->'recipientSnapshot',expected_actor,requested_operation) RETURNING * INTO review_row;
   PERFORM crest_private.append_completion_audit('review_requests',to_jsonb(review_row));
   FOR encounter IN SELECT * FROM crest.job_encounters WHERE business_id=requested_business AND job_id=j.id ORDER BY id LOOP
    INSERT INTO crest.review_request_encounters(business_id,job_id,request_id,job_encounter_id,created_by,operation_id) VALUES(requested_business,j.id,review_row.id,encounter.id,expected_actor,requested_operation) RETURNING * INTO binding;PERFORM crest_private.append_completion_audit('review_request_encounters',to_jsonb(binding));
   END LOOP;
   IF message_id IS NOT NULL THEN
    INSERT INTO crest.messages(id,business_id,job_id,customer_id,request_id,template_version_id,purpose,state,channel,recipient_snapshot,body_snapshot,created_by,operation_id) VALUES(message_id,requested_business,j.id,j.customer_id,review_row.id,template.id,'review_request','prepared',CASE review_row.recipient_snapshot->>'kind' WHEN 'phone' THEN 'text' ELSE 'email' END,review_row.recipient_snapshot,replace(template.body_template,'{review_url}',body->'review'->>'reviewUrl'),expected_actor,requested_operation) RETURNING * INTO message;PERFORM crest_private.append_completion_audit('messages',to_jsonb(message));
    INSERT INTO crest.message_events(business_id,job_id,message_id,kind,effective_at,created_by,operation_id) VALUES(requested_business,j.id,message.id,'prepared',stamp,expected_actor,requested_operation) RETURNING * INTO message_event;PERFORM crest_private.append_completion_audit('message_events',to_jsonb(message_event));
   END IF;
   INSERT INTO crest.job_finalization_tasks(business_id,job_id,kind,reason,created_by,operation_id) VALUES(requested_business,j.id,'invoice_finalization','Review fulfilled accepted scope, tax and issuance before billing',expected_actor,requested_operation) RETURNING * INTO task;PERFORM crest_private.append_completion_audit('job_finalization_tasks',to_jsonb(task));
   IF j.completion_outcome='partial' THEN INSERT INTO crest.job_finalization_tasks(business_id,job_id,kind,reason,created_by,operation_id) VALUES(requested_business,j.id,'commercial_resolution','Partial work does not change accepted customer obligations',expected_actor,requested_operation) RETURNING * INTO task;PERFORM crest_private.append_completion_audit('job_finalization_tasks',to_jsonb(task));END IF;
   -- Reserve the event ID before constructing its immutable result; its audit
   -- joins the same transaction, never a post-commit success repair.
   event.id:=gen_random_uuid();
   INSERT INTO crest.job_events(id,business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(event.id,requested_business,j.id,j.version,before_job->>'state','completed',stamp,body->>'reason',jsonb_build_object('schemaVersion',1,'action','complete','request',request,'scopePlan',scope_plan,'closedWorkIntervalId',closed_work.id,'reviewDetails',review,'photoEvidenceStatus','not_integrated'),expected_actor,requested_operation) RETURNING * INTO event;
   -- Evidence/result must be frozen on INSERT. Compute the complete receipt
   -- from actual rows, then include it in the pending operation; the getter
   -- reconstructs it independently from immutable source, not event rewriting.
   PERFORM crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event));
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.complete','businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',j.id,'jobVersion',j.version::text,'completedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'completionOutcome',j.completion_outcome,'closedWorkIntervalId',closed_work.id,'allocationPlanIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.allocation_plan_versions WHERE business_id=requested_business AND operation_id=requested_operation),'outcomeIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.work_scope_outcomes WHERE business_id=requested_business AND operation_id=requested_operation),'reviewRequestId',review_row.id,'messageId',message_id,'finalizationTaskIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.job_finalization_tasks WHERE business_id=requested_business AND operation_id=requested_operation),'auditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
   PERFORM crest_private.check_completed_job_graph(requested_business,j.id,requested_operation);result:=crest_private.completed_job_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1901' THEN GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',reason);
 END;
END $complete$;
CREATE FUNCTION crest_commands.lookup_completed_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.completed_job_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_completed_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_completed_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_completed_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
