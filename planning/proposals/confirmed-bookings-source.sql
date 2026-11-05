-- Unregistered complete physical booking/mode source readers over49.
-- Export credential only, on one READ ONLY REPEATABLE READ transaction.
-- JSONB source columns are original SQL JSON text, never JS-reserialized values.
DO $review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_booking_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='crest_export'::regrole)
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_schema_owner'::regrole))) a WHERE a.grantee<>'crest_schema_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_schema_owner'::regrole AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_booking_owner',oid,'CREATE'))
  OR to_regprocedure('crest_commands.quote_commercial_snapshot_context(uuid)') IS NULL OR to_regprocedure('crest_commands.business_history_export_context(uuid)') IS NULL
  OR to_regprocedure('crest_commands.booking_source_snapshot_context(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.fulfillment_mode_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.fulfillment_mode_versions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','sequence','replaces_sequence','mobile_enabled','dropoff_enabled','pickup_return_enabled','reason','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.fulfillment_mode_projection(crest.fulfillment_mode_versions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.jobs'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.jobs'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','customer_id','operator_actor_id','fulfillment_mode','mode_version_id','work_address_id','work_location_snapshot','state','current_appointment_id','first_work_at','completed_at','completion_outcome','version','updated_at','updated_by','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.jobs_projection(crest.jobs)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.job_vehicles'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.job_vehicles'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','vehicle_id','customer_vehicle_id','vehicle_snapshot','customer_snapshot','pickup_address_id','return_address_id','pickup_location_snapshot','return_location_snapshot','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.job_vehicles_projection(crest.job_vehicles)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.job_encounters'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.job_encounters'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','customer_id','family_id','agreement_id','encounter_id','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.job_encounters_projection(crest.job_encounters)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.appointments'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.appointments'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','sequence','replaces_id','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','confirmation_state','customer_confirmation','contact_snapshot','unknown_travel_reviewed','reason','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.appointments_projection(crest.appointments)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.operator_controls'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.operator_controls'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','operator_actor_id','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.operator_controls_projection(crest.operator_controls)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.schedule_reservations'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.schedule_reservations'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','appointment_id','operator_actor_id','blocked_interval','unknown_travel','override_id','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.schedule_reservations_projection(crest.schedule_reservations)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.schedule_overrides'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.schedule_overrides'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','appointment_id','reason','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.schedule_overrides_projection(crest.schedule_overrides)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.schedule_override_conflicts'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.schedule_override_conflicts'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','override_id','conflicting_appointment_id','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.schedule_override_conflicts_projection(crest.schedule_override_conflicts)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.allocation_plan_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.allocation_plan_versions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','source_allocation_id','sequence','replaces_id','reason','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.allocation_plan_versions_projection(crest.allocation_plan_versions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.allocation_plan_parts'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.allocation_plan_parts'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','plan_id','stable_partition_id','job_id','allocation_state','gross_inclusive_cents','discount_inclusive_cents','amount_cents','scope_description','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.allocation_plan_parts_projection(crest.allocation_plan_parts)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.job_events'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.job_events'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','sequence','from_state','to_state','effective_at','reason','evidence','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.job_events_projection(crest.job_events)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id) ON crest.businesses TO crest_booking_owner;
CREATE POLICY booking_export_business ON crest.businesses FOR SELECT TO crest_booking_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.booking_source_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE commercial jsonb;history jsonb;counts jsonb;total numeric;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SCOPE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SCOPE_REQUIRED';END IF;
 commercial:=crest_commands.quote_commercial_snapshot_context(requested_business);history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 SELECT jsonb_build_object('fulfillment_mode_versions',(SELECT count(*)::text FROM crest.fulfillment_mode_versions WHERE business_id=requested_business),'jobs',(SELECT count(*)::text FROM crest.jobs WHERE business_id=requested_business),'job_vehicles',(SELECT count(*)::text FROM crest.job_vehicles WHERE business_id=requested_business),'job_encounters',(SELECT count(*)::text FROM crest.job_encounters WHERE business_id=requested_business),'appointments',(SELECT count(*)::text FROM crest.appointments WHERE business_id=requested_business),'operator_controls',(SELECT count(*)::text FROM crest.operator_controls WHERE business_id=requested_business),'schedule_reservations',(SELECT count(*)::text FROM crest.schedule_reservations WHERE business_id=requested_business),'schedule_overrides',(SELECT count(*)::text FROM crest.schedule_overrides WHERE business_id=requested_business),'schedule_override_conflicts',(SELECT count(*)::text FROM crest.schedule_override_conflicts WHERE business_id=requested_business),'allocation_plan_versions',(SELECT count(*)::text FROM crest.allocation_plan_versions WHERE business_id=requested_business),'allocation_plan_parts',(SELECT count(*)::text FROM crest.allocation_plan_parts WHERE business_id=requested_business),'job_events',(SELECT count(*)::text FROM crest.job_events WHERE business_id=requested_business)) INTO counts;
 SELECT sum((value#>>'{}')::numeric) INTO total FROM jsonb_each(counts);IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','confirmed_booking_sources','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.confirmed-booking.sources/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'commercialSnapshotToken',commercial->>'snapshotToken','historySnapshotToken',history->>'snapshotToken','expectedCounts',counts);
END $context$;
CREATE FUNCTION crest_commands.booking_source_snapshot_fulfillment_mode_versions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.fulfillment_mode_versions WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.fulfillment_mode_projection(p::crest.fulfillment_mode_versions) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.fulfillment_mode_versions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_jobs(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.jobs WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.jobs_projection(p::crest.jobs)||jsonb_build_object('work_location_snapshot',p.work_location_snapshot::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.jobs later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_job_vehicles(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.job_vehicles WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.job_vehicles_projection(p::crest.job_vehicles)||jsonb_build_object('vehicle_snapshot',p.vehicle_snapshot::text,'customer_snapshot',p.customer_snapshot::text,'pickup_location_snapshot',p.pickup_location_snapshot::text,'return_location_snapshot',p.return_location_snapshot::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.job_vehicles later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_job_encounters(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.job_encounters WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.job_encounters_projection(p::crest.job_encounters) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.job_encounters later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_appointments(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.appointments WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.appointments_projection(p::crest.appointments)||jsonb_build_object('customer_confirmation',p.customer_confirmation::text,'contact_snapshot',p.contact_snapshot::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.appointments later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_operator_controls(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.operator_controls WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.operator_controls_projection(p::crest.operator_controls) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.operator_controls later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_schedule_reservations(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.schedule_reservations WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.schedule_reservations_projection(p::crest.schedule_reservations)||jsonb_build_object('blocked_interval',(crest_private.schedule_reservations_projection(p::crest.schedule_reservations)->'blocked_interval')::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.schedule_reservations later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_schedule_overrides(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.schedule_overrides WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.schedule_overrides_projection(p::crest.schedule_overrides) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.schedule_overrides later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_schedule_override_conflicts(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.schedule_override_conflicts WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.schedule_override_conflicts_projection(p::crest.schedule_override_conflicts) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.schedule_override_conflicts later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_allocation_plan_versions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.allocation_plan_versions WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.allocation_plan_versions_projection(p::crest.allocation_plan_versions) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.allocation_plan_versions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_allocation_plan_parts(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.allocation_plan_parts_projection(p::crest.allocation_plan_parts) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.allocation_plan_parts later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_job_events(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.job_events WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.job_events_projection(p::crest.job_events)||jsonb_build_object('evidence',p.evidence::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.job_events later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_commands.quote_commercial_snapshot_context(uuid),crest_commands.business_history_export_context(uuid) TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_context(uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_fulfillment_mode_versions(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_jobs(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_job_vehicles(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_job_encounters(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_appointments(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_operator_controls(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_schedule_reservations(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_schedule_overrides(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_schedule_override_conflicts(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_allocation_plan_versions(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_allocation_plan_parts(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_job_events(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_context(uuid) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_fulfillment_mode_versions(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_fulfillment_mode_versions(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_jobs(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_jobs(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_job_vehicles(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_job_vehicles(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_job_encounters(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_job_encounters(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_appointments(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_appointments(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_operator_controls(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_operator_controls(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_schedule_reservations(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_schedule_reservations(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_schedule_overrides(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_schedule_overrides(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_schedule_override_conflicts(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_schedule_override_conflicts(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_allocation_plan_versions(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_allocation_plan_versions(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_allocation_plan_parts(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_allocation_plan_parts(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_job_events(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_job_events(uuid,text,uuid,integer) TO crest_export;
