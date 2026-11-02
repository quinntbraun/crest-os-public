-- Unregistered construction dependency: admit only the installed book command.
-- This does not register schema50 or activate the running owner database.
DO $review$
DECLARE name text;role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['crest_booking_owner','crest_booking_integrity_owner'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
   OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=role_name::regrole OR member=role_name::regrole)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') AND proowner='crest_booking_owner'::regrole AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_job_graph(uuid,uuid,uuid)') AND proowner='crest_booking_integrity_owner'::regrole AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
 FOREACH name IN ARRAY ARRAY['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('crest.'||name) AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_construction_closed' AND tgenabled='O' AND tgfoid='crest_private.booking_construction_closed()'::regprocedure)
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_stamp' AND tgenabled='O' AND tgfoid='crest_private.stamp_booking_row()'::regprocedure)
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_audit' AND tgenabled='O' AND tgdeferrable AND tginitdeferred AND tgfoid='crest_private.check_booking_row_audit()'::regprocedure)
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_retain_truncate' AND tgenabled='O' AND tgfoid='crest_private.retain_booking_history()'::regprocedure)
   OR has_table_privilege('crest_web','crest.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
  IF name IN('jobs','job_vehicles','job_encounters','appointments','schedule_reservations','schedule_overrides','schedule_override_conflicts','job_events') AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_graph' AND tgenabled='O' AND tgdeferrable AND tginitdeferred AND tgfoid='crest_private.check_booking_job_source()'::regprocedure) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.allocation_plan_versions'::regclass AND tgname='booking_validate_plan' AND tgenabled='O' AND tgfoid='crest_private.validate_booking_plan_append()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.allocation_plan_versions'::regclass AND tgname='booking_plan_total' AND tgenabled='O' AND tgdeferrable AND tginitdeferred AND tgfoid='crest_private.check_booking_plan()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.allocation_plan_parts'::regclass AND tgname='booking_plan_part_total' AND tgenabled='O' AND tgdeferrable AND tginitdeferred AND tgfoid='crest_private.check_booking_plan()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.schedule_reservations'::regclass AND tgname='booking_validate_reservation' AND tgenabled='O' AND tgfoid='crest_private.validate_booking_reservation()'::regprocedure)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.authorize_booking_statement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $guard$
BEGIN
 IF current_user<>'crest_booking_owner' OR TG_OP<>'INSERT' OR NOT EXISTS(
  SELECT 1 FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
   AND command_type='operations.job.book' AND schema_version=1 AND state='pending')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;
 RETURN NULL;
END $guard$;
REVOKE ALL ON FUNCTION crest_private.authorize_booking_statement() FROM PUBLIC;
DO $install$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events'] LOOP
  EXECUTE format('DROP TRIGGER booking_construction_closed ON crest.%I',name);
  EXECUTE format('CREATE TRIGGER booking_command_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.%I FOR EACH STATEMENT EXECUTE FUNCTION crest_private.authorize_booking_statement()',name);
 END LOOP;
END $install$;
RESET ROLE;
