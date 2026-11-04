-- UNREGISTERED complete acceptance command/integrity construction.
-- Exact registered52 predecessor bodies are pinned below. No owner migration,
-- production/finance activation or application HTTP route is introduced.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52 OR to_regprocedure('crest_private.amendment_accept_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_commands.accept_quote_amendment_confirmation(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)') IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner','crest_booking_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole,'crest_booking_integrity_owner'::regrole)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid) OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.authorize_booking_statement()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='bdc564576bec43654ab70b462af58221465c8b3dabcfd4385773304850ef0152') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.stamp_booking_row()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='1c532f712523e82d9210bd4e2e3d12a6fafebaabd7c2e24ca1bb6c74bdbfe4d3') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_row_audit()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='2ef479c8f6f183d9e287071515e5416f56e5e314cf9973f0141cdaab8c324cfe') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_plan()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='7878215d65c79004d51044a16b977e37320cab0514a99419cd1e4fa63ff01b8a') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.stamp_quote_commercial()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='3d76d9b2e40fba6248d73a83e10498e8fd9bf978464d7528601553d1779cc28e') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.validate_quote_revision_change()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='351637586c8ea8445e6d4d6e8bf7b91c74fce6a0b219296c5581ef8029d2eda4') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_quote_audit()') AND proowner='crest_quote_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='a240b109f88748f73abeae3493b51e8271ee6e16d58d6b8db20a80b22970dcb9') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_quote_commercial_row()') AND proowner='crest_quote_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='7d71eb2a059269890c0a0fae3b2d11c18ae8c56556cf9a9991e945db6e347512') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_commercial_operation_result(uuid,uuid,uuid)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='d253e4d7e962cd6d97c3e6162559772d66bdd6a6ed96a1b19acd04d4e0b61ce7') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_quote_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_integrity_owner,crest_booking_integrity_owner;
CREATE POLICY amendment_accept_operation_read ON crest_private.operations FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='quote.amendment.accept');
CREATE POLICY amendment_accept_operation_create ON crest_private.operations FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='quote.amendment.accept' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY amendment_accept_operation_finish ON crest_private.operations FOR UPDATE TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='quote.amendment.accept') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='quote.amendment.accept' AND schema_version=1);
CREATE POLICY amendment_accept_operation_integrity ON crest_private.operations FOR SELECT TO crest_quote_integrity_owner,crest_booking_integrity_owner USING(command_type='quote.amendment.accept' AND schema_version=1);
GRANT INSERT ON crest.allocation_plan_versions,crest.allocation_plan_parts TO crest_quote_owner;
CREATE POLICY amendment_accept_plan_create ON crest.allocation_plan_versions FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
CREATE POLICY amendment_accept_plan_create ON crest.allocation_plan_parts FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
CREATE POLICY amendment_accept_plan_audit_create ON crest_private.audit_events FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind IN('allocation_plan_versions','allocation_plan_parts') AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
GRANT EXECUTE ON FUNCTION crest_private.amendment_accept_result(uuid,uuid,uuid) TO crest_quote_integrity_owner,crest_booking_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.authorize_booking_statement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE kind text;
BEGIN
 IF current_user='crest_quote_owner' AND TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts') THEN
  SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL;
  IF kind IS DISTINCT FROM 'quote.amendment.accept' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF current_user<>'crest_booking_owner' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL;
 IF NOT coalesce(kind='operations.job.book' AND TG_OP='INSERT' OR kind='operations.job.cancel' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations') OR kind='operations.job.reschedule' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','job_events','schedule_reservations','schedule_overrides','schedule_override_conflicts') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations'),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.stamp_booking_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE stamp timestamptz:=clock_timestamp();actor uuid;operation uuid;kind text;
BEGIN
 actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 IF actor IS NULL OR operation IS NULL OR NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.operation_id IS DISTINCT FROM operation OR NEW.origin<>'manual' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_CONTEXT_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL;
 IF kind='quote.amendment.accept' AND NOT(TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATION_REQUIRED';END IF;
 IF kind IS NULL OR kind NOT IN('operations.job.book','operations.job.reschedule','operations.job.cancel','quote.amendment.accept') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATION_REQUIRED';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ACTOR_REQUIRED';END IF;NEW.created_at:=stamp;
  IF TG_TABLE_NAME='jobs' THEN IF kind<>'operations.job.book' OR NEW.version<>1 OR NEW.updated_by<>actor OR NEW.state<>'scheduled' OR NEW.first_work_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.completion_outcome IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;NEW.updated_at:=stamp;END IF;
 ELSE
  IF TG_TABLE_NAME<>'jobs' OR ROW(NEW.id,NEW.business_id,NEW.customer_id,NEW.operator_actor_id,NEW.created_at,NEW.created_by,NEW.origin) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.customer_id,OLD.operator_actor_id,OLD.created_at,OLD.created_by,OLD.origin) OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR OLD.state<>'scheduled' OR OLD.first_work_at IS NOT NULL OR ROW(NEW.first_work_at,NEW.completed_at,NEW.completion_outcome) IS DISTINCT FROM ROW(OLD.first_work_at,OLD.completed_at,OLD.completion_outcome) OR NOT(kind='operations.job.reschedule' AND NEW.state='scheduled' OR kind='operations.job.cancel' AND NEW.state='cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;
  NEW.updated_at:=stamp;
  IF kind='operations.job.cancel' AND ROW(NEW.fulfillment_mode,NEW.mode_version_id,NEW.work_address_id,NEW.work_location_snapshot) IS DISTINCT FROM ROW(OLD.fulfillment_mode,OLD.mode_version_id,OLD.work_address_id,OLD.work_location_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SOURCE_RETAINED';END IF;
 END IF;
 RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_booking_row_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE b uuid;entity uuid;actor uuid;operation uuid;revision bigint;verb text;before_row jsonb:='null'::jsonb;after_row jsonb:='null'::jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME<>'schedule_reservations' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_BOOKING_HISTORY_RETAINED';END IF;
  b:=OLD.business_id;entity:=OLD.id;actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;revision:=2;verb:='release';
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;
 ELSE
  b:=NEW.business_id;entity:=NEW.id;operation:=NEW.operation_id;verb:=CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'revise' END;
  IF TG_TABLE_NAME='jobs' THEN actor:=NEW.updated_by;revision:=NEW.version;ELSE actor:=NEW.created_by;revision:=1;END IF;
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO after_row USING NEW;
  IF TG_OP='UPDATE' THEN EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts') AND EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=b AND operation_id=operation AND actor_id=actor AND command_type='quote.amendment.accept' AND schema_version=1) THEN verb:='accept';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=b AND a.operation_id=operation AND a.actor_id=actor AND a.created_by=actor AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=entity AND a.entity_version=revision AND a.action=verb AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',after_row) AND a.origin='manual' AND a.import_row_id IS NULL AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL AND (o.command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel') OR o.command_type='quote.amendment.accept' AND TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts')) AND(TG_OP<>'DELETE' OR o.command_type IN('operations.job.reschedule','operations.job.cancel')))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_AUDIT_REQUIRED';END IF;RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_booking_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE p crest.allocation_plan_versions;s crest.scope_allocations;e crest.scope_entitlements;kind text;part_count bigint;gross numeric;discount numeric;amount numeric;
BEGIN
 IF TG_TABLE_NAME='allocation_plan_versions' THEN SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.id;
 ELSE SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.plan_id;END IF;
 SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;
 SELECT * INTO e FROM crest.scope_entitlements WHERE business_id=p.business_id AND id=s.entitlement_id;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=p.business_id AND operation_id=p.operation_id AND actor_id=p.created_by;
 SELECT count(*),coalesce(sum(gross_inclusive_cents::numeric),0),coalesce(sum(discount_inclusive_cents::numeric),0),coalesce(sum(amount_cents::numeric),0) INTO part_count,gross,discount,amount FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id;
 IF kind='quote.amendment.accept' THEN
  IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR p.entitlement_version_id IS NULL OR NOT EXISTS(SELECT 1 FROM crest.entitlement_versions v JOIN crest.quote_family_commercial_state active ON active.business_id=v.business_id AND active.family_id=v.family_id AND active.current_agreement_id=v.agreement_id WHERE v.business_id=p.business_id AND v.id=p.entitlement_version_id AND v.entitlement_id=e.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ALLOCATION_BINDING_REQUIRED';END IF;
  IF crest_private.amendment_accept_result(p.business_id,p.created_by,p.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR kind IS NULL OR kind NOT IN('operations.job.book','operations.job.cancel') OR part_count=0 OR gross<>s.gross_inclusive_cents OR discount<>s.discount_inclusive_cents OR amount<>s.amount_cents
  OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state c WHERE c.business_id=p.business_id AND c.family_id=e.agreement_family_id AND c.current_agreement_id=s.agreement_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(a.operation_id<>p.operation_id OR a.created_by<>p.created_by))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_TOTAL_REQUIRED';END IF;
 IF kind='operations.job.book' AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.allocation_state='assigned' AND j.operation_id=p.operation_id AND j.state='scheduled')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_NEW_SCOPE_REQUIRED';END IF;
 -- Cancellation changes state, not the previously explicit money or scope.
 IF kind='operations.job.cancel' AND(p.replaces_id IS NULL
  OR EXISTS(SELECT 1 FROM(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.replaces_id) prior_part FULL JOIN(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id) next ON next.stable_partition_id=prior_part.stable_partition_id
    WHERE prior_part.id IS NULL OR next.id IS NULL OR ROW(next.job_id,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
       OR next.allocation_state IS DISTINCT FROM prior_part.allocation_state AND NOT(prior_part.allocation_state='assigned' AND next.allocation_state='cancelled' AND EXISTS(SELECT 1 FROM crest.jobs j WHERE j.business_id=prior_part.business_id AND j.id=prior_part.job_id AND j.state='cancelled' AND j.operation_id=p.operation_id)))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SCOPE_RETAINED';END IF;
 -- Stable partition identity cannot migrate into another entitlement's source.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.allocation_plan_parts other ON other.business_id=a.business_id AND other.stable_partition_id=a.stable_partition_id JOIN crest.allocation_plan_versions previous ON previous.business_id=other.business_id AND previous.id=other.plan_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND previous.source_allocation_id<>p.source_allocation_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.scope_allocations original ON original.business_id=a.business_id AND original.stable_partition_id=a.stable_partition_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND original.id<>p.source_allocation_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_PARTITION_IDENTITY_REQUIRED';END IF;
 -- A zero-dollar source/partition cannot disappear merely because the total
 -- remains zero. Preserve its original identity through explicit allocations.
 IF p.replaces_id IS NULL AND s.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=s.stable_partition_id)
  OR p.replaces_id IS NOT NULL AND EXISTS(SELECT 1 FROM crest.allocation_plan_parts prior_part WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=prior_part.stable_partition_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ZERO_IDENTITY_REQUIRED';END IF;
 -- Every assigned partition has the accepted customer's actual job and vehicle.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id JOIN crest.agreements agreement ON agreement.business_id=s.business_id AND agreement.id=s.agreement_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(j.customer_id<>agreement.customer_id OR NOT EXISTS(SELECT 1 FROM crest.job_encounters encounter WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND encounter.family_id=e.agreement_family_id) OR NOT e.job_wide AND NOT EXISTS(SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id AND v.vehicle_id=e.vehicle_id)))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_BINDING_REQUIRED';END IF;
 -- Existing assigned work stays intact when booking another visit; completed
 -- scope and active physical work cannot be moved by any booking command.
 IF p.replaces_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM crest.allocation_plan_parts prior_part JOIN crest.jobs j ON j.business_id=prior_part.business_id AND j.id=prior_part.job_id
  LEFT JOIN crest.allocation_plan_parts next ON next.business_id=prior_part.business_id AND next.plan_id=p.id AND next.stable_partition_id=prior_part.stable_partition_id
  WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND(
   prior_part.allocation_state='completed' OR j.state IN('en_route','in_progress','paused') OR prior_part.allocation_state='assigned' AND j.state='scheduled' AND kind='operations.job.book'
  ) AND ROW(next.job_id,next.allocation_state,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.allocation_state,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ASSIGNED_SCOPE_RETAINED';END IF;
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a LEFT JOIN crest.allocation_plan_parts prior_part ON prior_part.business_id=a.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.stable_partition_id=a.stable_partition_id LEFT JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(
  a.allocation_state='completed' AND(prior_part.id IS NULL OR prior_part.allocation_state<>'completed' OR ROW(a.job_id,a.gross_inclusive_cents,a.discount_inclusive_cents,a.amount_cents,a.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description))
  OR a.allocation_state='assigned' AND(prior_part.id IS NULL OR prior_part.job_id IS DISTINCT FROM a.job_id OR prior_part.allocation_state IS DISTINCT FROM 'assigned') AND(kind<>'operations.job.book' OR j.operation_id<>p.operation_id OR j.state<>'scheduled')
  OR a.allocation_state='cancelled' AND(prior_part.id IS NULL OR prior_part.allocation_state IS DISTINCT FROM 'cancelled') AND(kind<>'operations.job.cancel' OR j.operation_id<>p.operation_id OR j.state<>'cancelled')
 )) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_STATE_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.stamp_quote_commercial()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$ DECLARE stamp timestamptz:=clock_timestamp();BEGIN IF TG_OP='INSERT' THEN NEW.created_at:=stamp;IF NEW.version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_HISTORY_REQUIRED';END IF;ELSE IF TG_TABLE_NAME<>'quote_family_commercial_state' OR ROW(NEW.id,NEW.business_id,NEW.family_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.family_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) OR NEW.version<>OLD.version+1 OR (OLD.initial_acceptance_id IS NOT NULL AND (NEW.initial_acceptance_id IS DISTINCT FROM OLD.initial_acceptance_id OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND schema_version=1 AND (command_type='quote.amendment.send' AND NEW.current_agreement_id IS NOT DISTINCT FROM OLD.current_agreement_id OR command_type='quote.amendment.accept' AND NEW.current_agreement_id IS DISTINCT FROM OLD.current_agreement_id)))) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_COMMERCIAL_HISTORY_RETAINED';END IF;END IF;NEW.updated_at:=stamp;IF TG_TABLE_NAME='quote_sends' THEN NEW.confirmed_at:=stamp;ELSIF TG_TABLE_NAME='quote_acceptances' THEN NEW.recorded_at:=stamp;END IF;RETURN NEW;END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.validate_quote_revision_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE parent crest.quote_families; preceding bigint; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO parent FROM crest.quote_families WHERE business_id=NEW.business_id AND id=NEW.family_id FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_QUOTE_PARENT_REQUIRED';END IF;
 IF TG_OP='UPDATE' AND (OLD.state IN('Sent','Accepted','Superseded','Declined','Cancelled') OR NEW.state IN('Sent','Accepted','Superseded','Declined','Cancelled')) THEN
  IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['version','state','updated_at','updated_by','operation_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','updated_at','updated_by','operation_id']) OR OLD.state='Accepted' OR NOT(OLD.state='Ready for Review' AND NEW.state='Sent' OR OLD.state='Sent' AND NEW.state IN('Sent','Accepted','Superseded','Declined','Cancelled') OR OLD.state IN('Draft','Ready for Review') AND NEW.state='Cancelled') OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND schema_version=1 AND command_type IN('quote.manual.send','quote.confirmation.accept','quote.amendment.send','quote.amendment.accept')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_SENT_CONTENT_FROZEN';END IF;NEW.updated_at:=stamp;RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT coalesce(max(sequence),0) INTO preceding FROM crest.quote_revisions WHERE business_id=NEW.business_id AND family_id=NEW.family_id;
  IF NEW.sequence::numeric<>preceding::numeric+1 OR NEW.version<>1 OR NEW.content_version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;NEW.created_at:=stamp;
 ELSE
  IF ROW(NEW.id,NEW.business_id,NEW.family_id,NEW.sequence,NEW.kind,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.family_id,OLD.sequence,OLD.kind,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_PROVENANCE_RETAINED';END IF;
  IF NEW.version::numeric<>OLD.version::numeric+1 OR NEW.customer_safe_snapshot->>'schemaVersion'='1' AND OLD.customer_safe_snapshot->>'schemaVersion'='2' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
  IF NEW.canonical_content<>OLD.canonical_content THEN
   IF NEW.content_version::numeric<>OLD.content_version::numeric+1 OR NEW.state<>'Draft' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
  ELSIF NEW.content_version<>OLD.content_version OR ROW(NEW.customer_safe_snapshot,NEW.internal_snapshot,NEW.content_hash,NEW.total_cents,NEW.expiry_at,NEW.timezone,NEW.tax_readiness) IS DISTINCT FROM ROW(OLD.customer_safe_snapshot,OLD.internal_snapshot,OLD.content_hash,OLD.total_cents,OLD.expiry_at,OLD.timezone,OLD.tax_readiness) OR NOT(OLD.state='Draft' AND NEW.state='Ready for Review' OR OLD.state='Ready for Review' AND NEW.state='Ready for Review') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
 END IF;
 IF NEW.internal_snapshot->>'customerId' IS DISTINCT FROM (CASE WHEN NEW.kind='amendment' THEN (SELECT g.customer_id::text FROM crest.agreements g WHERE g.business_id=NEW.business_id AND g.family_id=NEW.family_id AND g.id=NEW.parent_agreement_id) ELSE parent.customer_id::text END) OR NEW.internal_snapshot->>'leadId' IS DISTINCT FROM parent.lead_id::text
  OR NEW.customer_safe_snapshot->>'currency' IS DISTINCT FROM 'USD' OR NEW.customer_safe_snapshot->'schemaVersion' NOT IN('1'::jsonb,'2'::jsonb)
  OR NEW.customer_safe_snapshot->>'totalCents' IS DISTINCT FROM NEW.total_cents::text OR NEW.customer_safe_snapshot->>'timezone' IS DISTINCT FROM NEW.timezone
  OR NEW.customer_safe_snapshot->>'expiryAt' IS DISTINCT FROM (CASE WHEN NEW.expiry_at IS NULL THEN NULL ELSE to_char(NEW.expiry_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_SNAPSHOT_CONFLICT';END IF;
 IF NEW.kind='amendment' AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.internal_snapshot->'sources') s JOIN crest.scope_entitlements e ON e.business_id=NEW.business_id AND e.agreement_family_id=NEW.family_id AND e.stable_line_key=(s->>'stableLineKey')::uuid WHERE e.vehicle_id IS DISTINCT FROM (s->>'vehicleId')::uuid OR e.job_wide IS DISTINCT FROM (s->>'jobWide')::boolean) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_SCOPE_IDENTITY_RETAINED';END IF;
 IF TG_OP='UPDATE' AND NEW.canonical_content=OLD.canonical_content THEN
  IF NOT crest_private.quote_review_ready(jsonb_build_object('customer',NEW.customer_safe_snapshot,'internal',NEW.internal_snapshot,'canonical',NEW.canonical_content)) OR NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.updated_by AND o.command_type=(CASE WHEN OLD.state='Draft' THEN 'quote.review.submit' ELSE 'quote.review.approve' END) AND o.schema_version=1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_REQUIRED';END IF;
 END IF;NEW.updated_at:=stamp;RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_quote_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE prior jsonb:='null'::jsonb; following jsonb; kind text:=TG_TABLE_NAME; source jsonb; published boolean;
BEGIN
 IF kind='quote_families' THEN
  following:=crest_private.quote_family_projection(NEW::crest.quote_families);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_family_projection(OLD::crest.quote_families);END IF;
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_revisions r ON r.business_id=a.business_id AND r.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_revisions'
    AND a.entity_id=NEW.current_revision_id AND a.entity_version<=r.version AND r.family_id=NEW.id
    AND a.delta->'after'->>'version'=a.entity_version::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text) INTO published;
 ELSIF kind='quote_revisions' THEN
  following:=crest_private.quote_revision_projection(NEW::crest.quote_revisions);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_revision_projection(OLD::crest.quote_revisions);END IF;
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_families f ON f.business_id=a.business_id AND f.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_families'
    AND a.entity_id=NEW.family_id AND a.entity_version<=f.version AND a.delta->'after'->>'version'=a.entity_version::text
    AND a.delta->'after'->>'current_revision_id'=NEW.id::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text) INTO published;
 ELSIF kind='quote_items' THEN
  following:=crest_private.quote_item_projection(NEW::crest.quote_items);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_item_projection(OLD::crest.quote_items);END IF;
  source:=jsonb_build_object('stableLineKey',NEW.stable_line_key,'vehicleId',NEW.vehicle_id,'jobWide',NEW.job_wide,'serviceVersionId',NEW.service_version_id)||(CASE WHEN NEW.customer_snapshot?'category' THEN jsonb_build_object('assessment',CASE WHEN NEW.assessment_id IS NULL THEN 'null'::jsonb ELSE (SELECT crest_private.quote_assessment_packet(a) FROM crest.condition_assessments a WHERE a.business_id=NEW.business_id AND a.id=NEW.assessment_id AND a.vehicle_id=NEW.vehicle_id) END,'categoryOverrideNote',NEW.category_override_note) ELSE '{}'::jsonb END);
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_revisions r ON r.business_id=a.business_id AND r.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_revisions' AND a.entity_id=NEW.revision_id
    AND a.entity_version<=r.version AND a.delta->'after'->>'version'=a.entity_version::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text
    AND (NEW.active AND a.delta->'after'->'internal_snapshot'->'sources'->(NEW.position-1)=source AND a.delta->'after'->'customer_safe_snapshot'->'lines'->(NEW.position-1)=NEW.customer_snapshot
     OR NOT NEW.active AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.delta->'after'->'internal_snapshot'->'sources') s WHERE s->>'stableLineKey'=NEW.stable_line_key::text))) INTO published;
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 IF kind IN('quote_families','quote_revisions') AND EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type IN('quote.manual.send','quote.confirmation.accept','quote.amendment.send','quote.amendment.accept')) THEN
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=CASE WHEN kind='quote_families' THEN 'quote_revisions' ELSE 'quote_families' END AND (kind='quote_families' AND a.delta->'after'->>'family_id'=NEW.id::text OR kind='quote_revisions' AND a.entity_id::text=(to_jsonb(NEW)->>'family_id'))) INTO published;
 END IF;
 IF NOT published OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id
  WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=kind AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action=(CASE o.command_type WHEN 'quote.review.submit' THEN 'submit' WHEN 'quote.review.approve' THEN 'approve' WHEN 'quote.manual.send' THEN 'send' WHEN 'quote.amendment.send' THEN 'send' WHEN 'quote.amendment.accept' THEN 'accept' WHEN 'quote.confirmation.accept' THEN 'accept' ELSE CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'edit' END END) AND a.delta->'before'=prior AND a.delta->'after'=following
   AND (o.command_type IN('quote.draft.save','quote.replacement.create') AND o.schema_version IN(1,2) OR o.command_type='quote.amendment.create' AND o.schema_version=3 OR o.command_type IN('quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept','quote.amendment.send','quote.amendment.accept') AND o.schema_version=1 AND kind IN('quote_families','quote_revisions') AND TG_OP='UPDATE') AND o.origin=NEW.origin AND o.import_row_id IS NOT DISTINCT FROM NEW.import_row_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_quote_commercial_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$ DECLARE image jsonb;prior jsonb:='null'::jsonb;o crest_private.operations;receipt jsonb;member boolean;BEGIN
 CASE TG_TABLE_NAME
 WHEN 'quote_family_commercial_state' THEN image:=crest_private.quote_family_commercial_state_projection(NEW::crest.quote_family_commercial_state);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_family_commercial_state_projection(OLD::crest.quote_family_commercial_state);END IF;
 WHEN 'quote_sends' THEN image:=crest_private.quote_sends_projection(NEW::crest.quote_sends);
 WHEN 'quote_acceptances' THEN image:=crest_private.quote_acceptances_projection(NEW::crest.quote_acceptances);
 WHEN 'agreements' THEN image:=crest_private.agreements_projection(NEW::crest.agreements);
 WHEN 'scope_entitlements' THEN image:=crest_private.scope_entitlements_projection(NEW::crest.scope_entitlements);
 WHEN 'entitlement_versions' THEN image:=crest_private.entitlement_versions_projection(NEW::crest.entitlement_versions);
 WHEN 'scope_allocations' THEN image:=crest_private.scope_allocations_projection(NEW::crest.scope_allocations);
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END CASE;
 IF EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type='quote.amendment.accept' AND schema_version=1) THEN
  receipt:=crest_private.amendment_accept_result(NEW.business_id,NEW.updated_by,NEW.operation_id)->'receipt';
  member:=CASE TG_TABLE_NAME WHEN 'quote_family_commercial_state' THEN TG_OP='UPDATE' AND receipt->>'familyId'=NEW.id::text AND receipt->>'commercialStateVersion'=NEW.version::text WHEN 'quote_acceptances' THEN TG_OP='INSERT' AND receipt->>'acceptanceId'=NEW.id::text WHEN 'agreements' THEN TG_OP='INSERT' AND receipt->>'agreementId'=NEW.id::text WHEN 'scope_entitlements' THEN TG_OP='INSERT' AND receipt->'newEntitlementIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'entitlement_versions' THEN TG_OP='INSERT' AND receipt->'entitlementVersionIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'scope_allocations' THEN TG_OP='INSERT' AND receipt->'newAllocationIds' @> to_jsonb(ARRAY[NEW.id]) ELSE false END;
  IF member IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND actor_id=NEW.updated_by AND operation_id=NEW.operation_id AND entity_kind=TG_TABLE_NAME AND entity_id=NEW.id AND entity_version=NEW.version AND action='accept' AND delta->'before'=prior AND delta->'after'=image) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type='quote.amendment.send' AND schema_version=1) THEN
  receipt:=crest_private.amendment_send_result(NEW.business_id,NEW.updated_by,NEW.operation_id)->'receipt';
  member:=CASE WHEN TG_TABLE_NAME='quote_sends' AND TG_OP='INSERT' THEN receipt->>'sendId'=NEW.id::text WHEN TG_TABLE_NAME='quote_family_commercial_state' AND TG_OP='UPDATE' THEN receipt->>'familyId'=NEW.id::text AND receipt->>'commercialStateVersion'=NEW.version::text ELSE false END;
  IF member IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND actor_id=NEW.updated_by AND operation_id=NEW.operation_id AND entity_kind=TG_TABLE_NAME AND entity_id=NEW.id AND entity_version=NEW.version AND action='send' AND delta->'before'=prior AND delta->'after'=image) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_SEND_RESULT_REVIEW_REQUIRED';END IF;RETURN NULL;
 END IF;
 SELECT command_type,result,schema_version,state INTO o.command_type,o.result,o.schema_version,o.state FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type IN('quote.manual.send','quote.confirmation.accept') AND schema_version=1 AND state='committed';IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;receipt:=o.result;
 member:=CASE TG_TABLE_NAME WHEN 'quote_family_commercial_state' THEN receipt->>'familyId'=NEW.id::text AND receipt->>'commercialStateVersion'=NEW.version::text WHEN 'quote_sends' THEN receipt->>'action'='send' AND receipt->>'sendId'=NEW.id::text WHEN 'quote_acceptances' THEN receipt->>'acceptanceId'=NEW.id::text WHEN 'agreements' THEN receipt->>'agreementId'=NEW.id::text WHEN 'scope_entitlements' THEN receipt->'entitlementIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'entitlement_versions' THEN receipt->'entitlementVersionIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'scope_allocations' THEN receipt->'allocationIds' @> to_jsonb(ARRAY[NEW.id]) ELSE false END;
 IF member IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND actor_id=NEW.updated_by AND operation_id=NEW.operation_id AND entity_kind=TG_TABLE_NAME AND entity_id=NEW.id AND entity_version=NEW.version AND action=receipt->>'action' AND delta->'before'=prior AND delta->'after'=image) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;RETURN NULL;END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_private.quote_commercial_operation_result(business uuid, actor uuid, operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE o crest_private.operations;receipt jsonb;verb text;keys text[]:=ARRAY['schemaVersion','action','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','commercialStateVersion','commercialStateAuditEventId','approvalId','sendId','sendAuditEventId','acceptanceId','acceptanceAuditEventId','agreementId','agreementAuditEventId','customerId','entitlementIds','entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds','leadId','leadVersion','leadEventId','leadAuditEventId','leadEventAuditEventId','supersededRevisionId','supersededRevisionVersion','supersededRevisionAuditEventId'];key text;family_before jsonb;family_after jsonb;revision_before jsonb;revision_after jsonb;state_before jsonb;state_after jsonb;source_body jsonb;digest text;source_one uuid;source_two uuid;sent crest.quote_sends;accepted crest.quote_acceptances;agreement crest.agreements;approval crest.quote_approvals;entitlement crest.scope_entitlements;ent_version crest.entitlement_versions;allocation crest.scope_allocations;item crest.quote_items;lead_event crest.lead_events;lead_before jsonb;lead_after jsonb;event_image jsonb;expected_state text;expected_effective timestamptz;current_audits uuid[];n integer:=0;i integer;source_count bigint;sup_before jsonb;sup_after jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type IN('quote.manual.send','quote.confirmation.accept');IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 receipt:=o.result;verb:=CASE o.command_type WHEN 'quote.manual.send' THEN 'send' ELSE 'accept' END;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR NOT(receipt?&keys) OR receipt-keys<>'{}'::jsonb OR receipt->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR receipt->>'action' IS DISTINCT FROM verb OR receipt->>'businessId' IS DISTINCT FROM business::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 FOREACH key IN ARRAY ARRAY['businessId','familyId','revisionId','familyAuditEventId','revisionAuditEventId','commercialStateAuditEventId','approvalId','sendId','sendAuditEventId'] LOOP IF NOT crest_private.original_operation_uuid(receipt->key) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['familyVersion','revisionVersion','contentVersion','commercialStateVersion'] LOOP IF NOT crest_private.original_operation_version(receipt->key,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 IF jsonb_typeof(receipt->'contentHash') IS DISTINCT FROM 'string' OR (receipt->>'contentHash')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 FOREACH key IN ARRAY ARRAY['entitlementIds','entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds'] LOOP IF jsonb_typeof(receipt->key) IS DISTINCT FROM 'array' OR jsonb_array_length(receipt->key)>1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->key) v WHERE NOT crest_private.original_operation_uuid(v)) OR (SELECT count(DISTINCT v) FROM jsonb_array_elements(receipt->key) v)<>jsonb_array_length(receipt->key) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 family_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'familyAuditEventId')::uuid,'quote_families',(receipt->>'familyId')::uuid,(receipt->>'familyVersion')::bigint,verb);
 revision_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'revisionAuditEventId')::uuid,'quote_revisions',(receipt->>'revisionId')::uuid,(receipt->>'revisionVersion')::bigint,verb);
 state_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'commercialStateAuditEventId')::uuid,'quote_family_commercial_state',(receipt->>'familyId')::uuid,(receipt->>'commercialStateVersion')::bigint,verb);
 SELECT delta->'before' INTO family_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'familyAuditEventId')::uuid;SELECT delta->'before' INTO revision_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'revisionAuditEventId')::uuid;SELECT delta->'before' INTO state_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'commercialStateAuditEventId')::uuid;
 IF jsonb_typeof(family_before) IS DISTINCT FROM 'object' OR jsonb_typeof(revision_before) IS DISTINCT FROM 'object' OR family_after->>'id' IS DISTINCT FROM receipt->>'familyId' OR family_after->>'business_id' IS DISTINCT FROM business::text OR family_after->>'version' IS DISTINCT FROM receipt->>'familyVersion' OR family_after->>'updated_by' IS DISTINCT FROM actor::text OR family_after->>'operation_id' IS DISTINCT FROM operation::text OR (family_after->>'version')::numeric<>(family_before->>'version')::numeric+1 OR family_after-ARRAY['version','updated_at','updated_by','operation_id'] IS DISTINCT FROM family_before-ARRAY['version','updated_at','updated_by','operation_id']
 OR revision_after->>'id' IS DISTINCT FROM receipt->>'revisionId' OR revision_after->>'family_id' IS DISTINCT FROM receipt->>'familyId' OR revision_after->>'business_id' IS DISTINCT FROM business::text OR revision_after->>'version' IS DISTINCT FROM receipt->>'revisionVersion' OR revision_after->>'updated_by' IS DISTINCT FROM actor::text OR revision_after->>'operation_id' IS DISTINCT FROM operation::text OR (revision_after->>'version')::numeric<>(revision_before->>'version')::numeric+1 OR revision_after-ARRAY['state','version','updated_at','updated_by','operation_id'] IS DISTINCT FROM revision_before-ARRAY['state','version','updated_at','updated_by','operation_id'] OR revision_after->>'content_version' IS DISTINCT FROM receipt->>'contentVersion' OR revision_after->>'content_hash' IS DISTINCT FROM receipt->>'contentHash' OR encode(sha256(convert_to(revision_after->>'canonical_content','UTF8')),'hex') IS DISTINCT FROM receipt->>'contentHash'
 OR state_after->>'business_id' IS DISTINCT FROM business::text OR state_after->>'family_id' IS DISTINCT FROM receipt->>'familyId' OR state_after->>'id' IS DISTINCT FROM receipt->>'familyId' OR state_after->>'version' IS DISTINCT FROM receipt->>'commercialStateVersion' OR state_after->>'updated_by' IS DISTINCT FROM actor::text OR state_after->>'operation_id' IS DISTINCT FROM operation::text OR (state_after->>'version')::numeric<>(CASE WHEN state_before='null'::jsonb THEN 1 ELSE (state_before->>'version')::numeric+1 END)
 OR NOT EXISTS(SELECT 1 FROM crest.quote_families WHERE business_id=business AND id=(receipt->>'familyId')::uuid AND version>=(receipt->>'familyVersion')::bigint) OR NOT EXISTS(SELECT 1 FROM crest.quote_revisions WHERE business_id=business AND family_id=(receipt->>'familyId')::uuid AND id=(receipt->>'revisionId')::uuid AND version>=(receipt->>'revisionVersion')::bigint)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO sent FROM crest.quote_sends WHERE business_id=business AND id=(receipt->>'sendId')::uuid AND family_id=(receipt->>'familyId')::uuid AND revision_id=(receipt->>'revisionId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO approval FROM crest.quote_approvals WHERE business_id=business AND id=sent.approval_id AND id=(receipt->>'approvalId')::uuid AND family_id=sent.family_id AND revision_id=sent.revision_id AND approved_content_version=(receipt->>'contentVersion')::bigint AND approved_content_hash=receipt->>'contentHash' AND customer_representation=revision_after->'customer_safe_snapshot' AND presentation_hash=sent.presentation_hash;
 IF NOT FOUND OR NOT crest_private.quote_commercial_body_valid('send',sent.request) OR sent.request IS DISTINCT FROM jsonb_build_object('channel',sent.channel,'recipientSnapshot',sent.recipient_snapshot,'evidenceNote',sent.evidence_note,'confirmedActualSharing',true,'presentationHash',sent.presentation_hash,'replacesRevisionId',sent.replaces_revision_id) OR sent.lead_id::text IS DISTINCT FROM family_after->>'lead_id' OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'sendAuditEventId')::uuid AND entity_kind='quote_sends' AND entity_id=sent.id AND entity_version=1 AND action='send' AND operation_id=sent.operation_id AND actor_id=sent.created_by AND delta->'before'='null'::jsonb AND delta->'after'=crest_private.quote_sends_projection(sent)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 current_audits:=ARRAY[(receipt->>'familyAuditEventId')::uuid,(receipt->>'revisionAuditEventId')::uuid,(receipt->>'commercialStateAuditEventId')::uuid];
 IF verb='send' THEN
  IF sent.operation_id<>operation OR sent.created_by<>actor OR revision_before->>'state' NOT IN('Ready for Review','Sent') OR revision_after->>'state'<>'Sent' OR family_after->>'current_revision_id' IS DISTINCT FROM receipt->>'revisionId' OR state_after->>'active_offer_id' IS DISTINCT FROM receipt->>'revisionId' OR state_after->'initial_acceptance_id'<>'null'::jsonb OR state_after->'current_agreement_id'<>'null'::jsonb OR state_before<>'null'::jsonb AND state_before->'initial_acceptance_id'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  FOREACH key IN ARRAY ARRAY['acceptanceId','acceptanceAuditEventId','agreementId','agreementAuditEventId','customerId'] LOOP IF receipt->key IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  FOREACH key IN ARRAY ARRAY['entitlementIds','entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds'] LOOP IF receipt->key IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  source_body:=sent.request;source_one:=sent.id;source_two:=approval.id;current_audits:=current_audits||(receipt->>'sendAuditEventId')::uuid;
  IF sent.replaces_revision_id IS NOT NULL THEN
   IF state_before->>'active_offer_id' IS DISTINCT FROM sent.replaces_revision_id::text OR receipt->>'supersededRevisionId' IS DISTINCT FROM sent.replaces_revision_id::text OR NOT crest_private.original_operation_version(receipt->'supersededRevisionVersion',false) OR NOT crest_private.original_operation_uuid(receipt->'supersededRevisionAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   sup_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'supersededRevisionAuditEventId')::uuid,'quote_revisions',sent.replaces_revision_id,(receipt->>'supersededRevisionVersion')::bigint,'send');SELECT delta->'before' INTO sup_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'supersededRevisionAuditEventId')::uuid;
   IF sup_before->>'state'<>'Sent' OR sup_after->>'state'<>'Superseded' OR sup_after->>'family_id' IS DISTINCT FROM receipt->>'familyId' OR (sup_after->>'version')::numeric<>(sup_before->>'version')::numeric+1 OR sup_after-ARRAY['state','version','updated_at','updated_by','operation_id'] IS DISTINCT FROM sup_before-ARRAY['state','version','updated_at','updated_by','operation_id'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;current_audits:=current_audits||(receipt->>'supersededRevisionAuditEventId')::uuid;
  ELSE
   IF state_before<>'null'::jsonb AND state_before->>'active_offer_id' IS NOT NULL AND state_before->>'active_offer_id' IS DISTINCT FROM receipt->>'revisionId' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   FOREACH key IN ARRAY ARRAY['supersededRevisionId','supersededRevisionVersion','supersededRevisionAuditEventId'] LOOP IF receipt->key IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  END IF;
  expected_state:='quote_sent';expected_effective:=sent.confirmed_at;
 ELSE
  FOREACH key IN ARRAY ARRAY['acceptanceId','acceptanceAuditEventId','agreementId','agreementAuditEventId','customerId'] LOOP IF NOT crest_private.original_operation_uuid(receipt->key) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  SELECT * INTO accepted FROM crest.quote_acceptances WHERE business_id=business AND id=(receipt->>'acceptanceId')::uuid AND send_id=sent.id AND family_id=sent.family_id AND revision_id=sent.revision_id AND customer_id=(receipt->>'customerId')::uuid AND created_by=actor AND operation_id=operation;
  IF NOT FOUND OR accepted.content_hash IS DISTINCT FROM receipt->>'contentHash' OR accepted.lead_id::text IS DISTINCT FROM family_after->>'lead_id' OR accepted.confirmation_effective_at<approval.reviewed_at OR accepted.confirmation_effective_at>accepted.recorded_at OR revision_after->>'expiry_at' IS NOT NULL AND (revision_after->>'expiry_at')::timestamptz<=accepted.recorded_at OR NOT crest_private.quote_commercial_body_valid('accept',accepted.request) OR accepted.request IS DISTINCT FROM jsonb_build_object('sendId',sent.id,'customerId',accepted.customer_id,'conversionId',accepted.conversion_id,'channel',accepted.channel,'counterpartySnapshot',accepted.counterparty_snapshot,'confirmationEffectiveAt',to_char(accepted.confirmation_effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'evidenceNote',accepted.evidence_note,'confirmedExactTerms',true)
   OR family_after->>'customer_id' IS NOT NULL AND family_after->>'customer_id' IS DISTINCT FROM accepted.customer_id::text OR family_after->>'customer_id' IS NULL AND (accepted.conversion_id IS NULL OR accepted.lead_id IS NULL) OR accepted.conversion_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.lead_conversions WHERE business_id=business AND id=accepted.conversion_id AND lead_id=accepted.lead_id AND customer_id=accepted.customer_id)
   OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'acceptanceAuditEventId')::uuid,'quote_acceptances',accepted.id,1,'accept') IS DISTINCT FROM crest_private.quote_acceptances_projection(accepted)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  SELECT * INTO agreement FROM crest.agreements WHERE business_id=business AND id=(receipt->>'agreementId')::uuid AND acceptance_id=accepted.id AND family_id=sent.family_id AND customer_id=accepted.customer_id AND operation_id=operation AND created_by=actor;
  IF NOT FOUND OR agreement.version_no<>1 OR agreement.parent_agreement_id IS NOT NULL OR agreement.total_cents::text IS DISTINCT FROM revision_after->>'total_cents' OR agreement.signed_delta_cents<>agreement.total_cents OR agreement.customer_snapshot IS DISTINCT FROM revision_after->'customer_safe_snapshot' OR agreement.effective_at<>accepted.confirmation_effective_at OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'agreementAuditEventId')::uuid,'agreements',agreement.id,1,'accept') IS DISTINCT FROM crest_private.agreements_projection(agreement)
   OR revision_before->>'state'<>'Sent' OR revision_after->>'state'<>'Accepted' OR state_before->>'active_offer_id' IS DISTINCT FROM receipt->>'revisionId' OR state_before->'initial_acceptance_id' IS DISTINCT FROM 'null'::jsonb OR state_after->'active_offer_id' IS DISTINCT FROM 'null'::jsonb OR state_after->>'initial_acceptance_id' IS DISTINCT FROM accepted.id::text OR state_after->>'current_agreement_id' IS DISTINCT FROM agreement.id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  FOREACH key IN ARRAY ARRAY['supersededRevisionId','supersededRevisionVersion','supersededRevisionAuditEventId'] LOOP IF receipt->key IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  n:=jsonb_array_length(receipt->'entitlementIds');FOREACH key IN ARRAY ARRAY['entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds'] LOOP IF jsonb_array_length(receipt->key)<>n THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  IF n=0 OR n<>jsonb_array_length(revision_after->'customer_safe_snapshot'->'lines') OR n<>(SELECT count(*) FROM crest.scope_entitlements WHERE business_id=business AND agreement_family_id=sent.family_id AND operation_id=operation AND created_by=actor) OR n<>(SELECT count(*) FROM crest.entitlement_versions WHERE business_id=business AND agreement_id=agreement.id) OR n<>(SELECT count(*) FROM crest.scope_allocations WHERE business_id=business AND agreement_id=agreement.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  i:=0;FOR item IN SELECT * FROM crest.quote_items WHERE business_id=business AND revision_id=sent.revision_id AND active ORDER BY position LOOP
   SELECT * INTO entitlement FROM crest.scope_entitlements WHERE business_id=business AND id=(receipt->'entitlementIds'->>i)::uuid AND agreement_family_id=sent.family_id AND operation_id=operation AND created_by=actor;
   IF NOT FOUND OR entitlement.stable_line_key<>item.stable_line_key OR entitlement.initial_quote_item_id<>item.id OR entitlement.vehicle_id IS DISTINCT FROM item.vehicle_id OR entitlement.job_wide<>item.job_wide OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->'entitlementAuditEventIds'->>i)::uuid,'scope_entitlements',entitlement.id,1,'accept') IS DISTINCT FROM crest_private.scope_entitlements_projection(entitlement) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   SELECT * INTO ent_version FROM crest.entitlement_versions WHERE business_id=business AND id=(receipt->'entitlementVersionIds'->>i)::uuid AND entitlement_id=entitlement.id AND agreement_id=agreement.id AND family_id=sent.family_id AND operation_id=operation AND created_by=actor;
   IF NOT FOUND OR ent_version.source_quote_item_id<>item.id OR ent_version.authorized_cents<>item.final_cents OR ent_version.scope_snapshot IS DISTINCT FROM item.customer_snapshot OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->'entitlementVersionAuditEventIds'->>i)::uuid,'entitlement_versions',ent_version.id,1,'accept') IS DISTINCT FROM crest_private.entitlement_versions_projection(ent_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   SELECT * INTO allocation FROM crest.scope_allocations WHERE business_id=business AND id=(receipt->'allocationIds'->>i)::uuid AND entitlement_version_id=ent_version.id AND entitlement_id=entitlement.id AND agreement_id=agreement.id AND operation_id=operation AND created_by=actor;
   IF NOT FOUND OR allocation.amount_cents<>item.final_cents OR allocation.gross_inclusive_cents<>item.gross_cents OR allocation.discount_inclusive_cents::numeric<>item.line_discount_cents::numeric+item.allocated_discount_cents::numeric OR allocation.scope_snapshot IS DISTINCT FROM item.customer_snapshot OR allocation.scope_description IS DISTINCT FROM item.customer_snapshot->>'description' OR allocation.allocation_state<>'unassigned' OR allocation.job_id IS NOT NULL OR allocation.replaces_id IS NOT NULL OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->'allocationAuditEventIds'->>i)::uuid,'scope_allocations',allocation.id,1,'accept') IS DISTINCT FROM crest_private.scope_allocations_projection(allocation) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   current_audits:=current_audits||ARRAY[(receipt->'entitlementAuditEventIds'->>i)::uuid,(receipt->'entitlementVersionAuditEventIds'->>i)::uuid,(receipt->'allocationAuditEventIds'->>i)::uuid];i:=i+1;
  END LOOP;
  IF i<>n OR (SELECT sum(authorized_cents::numeric) FROM crest.entitlement_versions WHERE business_id=business AND agreement_id=agreement.id)<>agreement.total_cents::numeric OR (SELECT sum(amount_cents::numeric) FROM crest.scope_allocations WHERE business_id=business AND agreement_id=agreement.id)<>agreement.total_cents::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  current_audits:=current_audits||ARRAY[(receipt->>'acceptanceAuditEventId')::uuid,(receipt->>'agreementAuditEventId')::uuid];source_body:=accepted.request;source_one:=accepted.id;source_two:=agreement.id;expected_state:='won';expected_effective:=accepted.confirmation_effective_at;
 END IF;
 IF family_after->>'lead_id' IS NULL THEN
  FOREACH key IN ARRAY ARRAY['leadId','leadVersion','leadEventId','leadAuditEventId','leadEventAuditEventId'] LOOP IF receipt->key IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 ELSE
  IF receipt->>'leadId' IS DISTINCT FROM family_after->>'lead_id' OR NOT crest_private.original_operation_version(receipt->'leadVersion',false) OR NOT crest_private.original_operation_uuid(receipt->'leadEventId') OR NOT crest_private.original_operation_uuid(receipt->'leadAuditEventId') OR NOT crest_private.original_operation_uuid(receipt->'leadEventAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  SELECT * INTO lead_event FROM crest.lead_events WHERE business_id=business AND id=(receipt->>'leadEventId')::uuid AND lead_id=(receipt->>'leadId')::uuid AND lead_version=(receipt->>'leadVersion')::bigint AND operation_id=operation AND created_by=actor;
  IF NOT FOUND OR lead_event.to_state<>expected_state OR lead_event.effective_at<>expected_effective OR lead_event.quote_send_id IS DISTINCT FROM (CASE WHEN verb='send' THEN sent.id ELSE NULL END) OR lead_event.acceptance_id IS DISTINCT FROM accepted.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  lead_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'leadAuditEventId')::uuid,'leads',lead_event.lead_id,lead_event.lead_version,'state_change');SELECT delta->'before' INTO lead_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'leadAuditEventId')::uuid;
  event_image:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'leadEventAuditEventId')::uuid,'lead_events',lead_event.id,1,'create');
  IF event_image IS DISTINCT FROM crest_private.lead_event_projection(lead_event) OR lead_after->>'state' IS DISTINCT FROM lead_event.to_state OR lead_before->>'state' IS DISTINCT FROM lead_event.from_state OR lead_after->>'version' IS DISTINCT FROM lead_event.lead_version::text OR (lead_before->>'version')::numeric+1<>lead_event.lead_version OR lead_after-ARRAY['state','lost_reason','version','updated_at','updated_by','operation_id'] IS DISTINCT FROM lead_before-ARRAY['state','lost_reason','version','updated_at','updated_by','operation_id'] OR lead_after->'lost_reason' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  current_audits:=current_audits||ARRAY[(receipt->>'leadAuditEventId')::uuid,(receipt->>'leadEventAuditEventId')::uuid];
 END IF;
 digest:=crest_private.quote_commercial_digest(business,actor,o.recovery_epoch,verb,(receipt->>'familyId')::uuid,(receipt->>'revisionId')::uuid,(family_before->>'version')::bigint,(revision_before->>'version')::bigint,(receipt->>'contentVersion')::bigint,receipt->>'contentHash',source_one,source_two,source_body);
 IF digest IS DISTINCT FROM o.payload_hash OR cardinality(current_audits)<>(SELECT count(DISTINCT x) FROM unnest(current_audits) x) OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation)<>cardinality(current_audits) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE FUNCTION crest_private.check_quote_amendment_accept_operation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE original jsonb;retained_job crest.jobs;retained_appointment crest.appointments;
BEGIN
 IF NEW.command_type<>'quote.amendment.accept' THEN RETURN NULL;END IF;
 PERFORM set_config('crest.business_id',NEW.business_id::text,true),set_config('crest.actor_id',NEW.actor_id::text,true),set_config('crest.operation_id',NEW.operation_id::text,true);
 original:=crest_private.amendment_accept_result(NEW.business_id,NEW.actor_id,NEW.operation_id);
 IF NEW.schema_version<>1 OR original->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 -- The command does not book or reschedule. Preserve the already confirmed
 -- slot and its source history; do not re-evaluate historical CRM snapshots or
 -- old conflict acknowledgements against unrelated later bookings.
 FOR retained_job IN SELECT DISTINCT j.* FROM crest.allocation_plan_parts p JOIN crest.jobs j ON j.business_id=p.business_id AND j.id=p.job_id WHERE p.business_id=NEW.business_id AND p.operation_id=NEW.operation_id LOOP
  IF retained_job.customer_id IS DISTINCT FROM(original->'receipt'->>'customerId')::uuid OR retained_job.operation_id=NEW.operation_id OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations old_operation ON old_operation.business_id=a.business_id AND old_operation.operation_id=a.operation_id AND old_operation.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.entity_kind='jobs' AND a.entity_id=retained_job.id AND a.entity_version=retained_job.version AND a.operation_id=retained_job.operation_id AND a.actor_id=retained_job.updated_by AND a.delta->'after'=crest_private.jobs_projection(retained_job) AND old_operation.state='committed' AND old_operation.command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_JOB_REQUIRED';END IF;
  SELECT * INTO retained_appointment FROM crest.appointments WHERE business_id=NEW.business_id AND id=retained_job.current_appointment_id AND job_id=retained_job.id;
  IF retained_appointment.id IS NULL OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts part JOIN crest.scope_entitlements e ON e.business_id=part.business_id AND e.id=part.entitlement_id JOIN crest.quote_family_commercial_state control ON control.business_id=e.business_id AND control.family_id=e.agreement_family_id WHERE part.business_id=NEW.business_id AND part.job_id=retained_job.id AND (part.agreement_id IS DISTINCT FROM control.current_agreement_id OR NOT EXISTS(SELECT 1 FROM crest.job_encounters encounter WHERE encounter.business_id=NEW.business_id AND encounter.job_id=retained_job.id AND encounter.family_id=e.agreement_family_id) OR NOT e.job_wide AND NOT EXISTS(SELECT 1 FROM crest.job_vehicles vehicle WHERE vehicle.business_id=NEW.business_id AND vehicle.job_id=retained_job.id AND vehicle.vehicle_id=e.vehicle_id))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFIRMED_SCOPE_REQUIRED';END IF;
  IF retained_job.state='scheduled' THEN
   IF retained_appointment.confirmation_state<>'confirmed' OR retained_job.first_work_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state='assigned') OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state<>'assigned') OR NOT EXISTS(SELECT 1 FROM crest.schedule_reservations reservation WHERE reservation.business_id=NEW.business_id AND reservation.job_id=retained_job.id AND reservation.appointment_id=retained_appointment.id AND reservation.operator_actor_id=retained_job.operator_actor_id AND reservation.blocked_interval=tstzrange(retained_appointment.start_at-coalesce(retained_appointment.travel_before_seconds,0)*interval '1 second',retained_appointment.end_at+coalesce(retained_appointment.travel_after_seconds,0)*interval '1 second','[)')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_SLOT_REQUIRED';END IF;
  ELSIF retained_job.state='cancelled' THEN
   IF retained_appointment.confirmation_state<>'cancelled' OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state<>'cancelled') OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=NEW.business_id AND job_id=retained_job.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLATION_REQUIRED';END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_FIELD_IMPLEMENTATION_REQUIRED';END IF;
 END LOOP;
 RETURN NULL;
END $check$;
REVOKE ALL ON FUNCTION crest_private.check_quote_amendment_accept_operation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_quote_amendment_accept_operation() TO crest_schema_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER quote_amendment_accept_result AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_amendment_accept_operation();
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_commands.accept_quote_amendment_confirmation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_private.apply_quote_amendment_acceptance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) $$;
CREATE FUNCTION crest_commands.lookup_quote_amendment_acceptance(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ BEGIN IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_ACCEPT_INPUT_REQUIRED';END IF;PERFORM crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id','',true);RETURN crest_private.amendment_accept_result(requested_business,expected_actor,requested_operation);END $$;
REVOKE ALL ON FUNCTION crest_commands.accept_quote_amendment_confirmation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb),crest_commands.lookup_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.accept_quote_amendment_confirmation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb),crest_commands.lookup_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_quote_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner,crest_booking_integrity_owner;
RESET ROLE;
