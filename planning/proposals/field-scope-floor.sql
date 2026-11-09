-- Unregistered Phase6 construction. Preserve actual fulfilled portions through
-- later commercial/booking plans. This authorizes no financial consumption.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.completed_job_result(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('crest_private.check_completed_scope_floor(uuid,uuid,uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.amendment_accept_result(uuid,uuid,uuid)','crest_quote_owner',true,'367adbfce356da6671c1bb328a5089c09ada5a54d5c0023a14314b999dfc7758'),
   ('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)','crest_quote_owner',false,'14a6c72922999a32e5e2cd398f54ebdca27469c0a5e66e3e6761e32ecb1b43d1'),
   ('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'bb24d3913d30194af74cd4ab53ef4c40d849a66a8c9270d1339a14bbce49a83e'),
   ('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'679c95e0e89ac8418b36a61981c0f0a3f829888db0eef684823554fd463f3005'),
   ('crest_private.check_booking_plan()','crest_booking_integrity_owner',true,'1c55cdf246af977128c774b5e68341cae6b181ca97466797c132a8c3af254fa7'),
   ('crest_private.check_quote_amendment_accept_operation()','crest_booking_integrity_owner',true,'7276908984cef333f476fd4cdd9fa7929d2bf18d2cf81ba62aa1258856bc7bd5'),
   ('crest_private.check_amendment_allocation_binding()','crest_booking_integrity_owner',true,'c5662c263dfd81142b52a2dfb18e5788f0e066ada9eb36e7e963bbc9deceff5b')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner
   WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner','crest_quote_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole,'crest_quote_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole,'crest_quote_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole,'crest_quote_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner','crest_quote_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM(VALUES('work_intervals'),('travel_legs'),('operator_occupancy'),('work_scope_outcomes'),('message_templates'),('review_requests'),('messages'),('message_events'),('review_request_encounters'),('job_finalization_tasks')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass('crest.'||e.name) WHERE c.oid IS NULL OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR (SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '7d59758a46a631d2ddb9db8df7825aeb77745ba121655b85b4acb87b2748d56b'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_SCOPE_FLOOR_SOURCE_REQUIRED';END IF;
END $review$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.check_completed_scope_floor(business uuid,source_id uuid,target_plan uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $floor$
DECLARE target crest.allocation_plan_versions;
BEGIN
 SELECT * INTO target FROM crest.allocation_plan_versions WHERE business_id=business AND id=target_plan AND source_allocation_id=source_id;
 IF target.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_FLOOR_REQUIRED';END IF;
 -- A completed portion must originate in actual typed completion evidence,
 -- not a copied price, a customer acceptance or a plan's self-asserted state.
 IF EXISTS(
  SELECT 1 FROM crest.allocation_plan_parts part WHERE part.business_id=business AND part.plan_id=target.id AND part.allocation_state='completed' AND NOT EXISTS(
   SELECT 1 FROM crest.work_scope_outcomes outcome
   JOIN crest.allocation_plan_parts original ON original.business_id=outcome.business_id AND original.id=outcome.completion_part_id
   JOIN crest.allocation_plan_versions plan ON plan.business_id=original.business_id AND plan.id=original.plan_id
   JOIN crest_private.operations operation ON operation.business_id=outcome.business_id AND operation.operation_id=outcome.operation_id AND operation.actor_id=outcome.created_by
   WHERE outcome.business_id=business AND outcome.outcome='completed' AND plan.source_allocation_id=source_id AND plan.sequence<=target.sequence
    AND original.allocation_state='completed' AND original.operation_id=outcome.operation_id AND plan.operation_id=outcome.operation_id
    AND original.job_id=outcome.job_id AND original.stable_partition_id=outcome.partition_id AND original.scope_description=outcome.scope_description AND original.amount_cents=outcome.completed_cents
    AND operation.command_type='operations.job.complete' AND operation.state='committed'
    AND ROW(part.stable_partition_id,part.job_id,part.gross_inclusive_cents,part.discount_inclusive_cents,part.amount_cents,part.scope_description)
     IS NOT DISTINCT FROM ROW(original.stable_partition_id,original.job_id,original.gross_inclusive_cents,original.discount_inclusive_cents,original.amount_cents,original.scope_description)
  )
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_FLOOR_REQUIRED';END IF;
 -- Every fulfilled portion in this immutable plan prefix remains present and
 -- exact, including zero-price identity. Later completions must not invalidate
 -- an older plan/original receipt, so never compare with the latest plan here.
 IF EXISTS(
  SELECT 1 FROM crest.work_scope_outcomes outcome
  JOIN crest.allocation_plan_parts original ON original.business_id=outcome.business_id AND original.id=outcome.completion_part_id
  JOIN crest.allocation_plan_versions plan ON plan.business_id=original.business_id AND plan.id=original.plan_id
  WHERE outcome.business_id=business AND outcome.outcome='completed' AND plan.source_allocation_id=source_id AND plan.sequence<=target.sequence AND NOT EXISTS(
   SELECT 1 FROM crest.allocation_plan_parts part WHERE part.business_id=business AND part.plan_id=target.id AND part.allocation_state='completed'
    AND ROW(part.stable_partition_id,part.job_id,part.gross_inclusive_cents,part.discount_inclusive_cents,part.amount_cents,part.scope_description)
     IS NOT DISTINCT FROM ROW(original.stable_partition_id,original.job_id,original.gross_inclusive_cents,original.discount_inclusive_cents,original.amount_cents,original.scope_description)
  )
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_FLOOR_REQUIRED';END IF;
END $floor$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_completed_scope_floor(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_completed_scope_floor(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_completed_scope_floor(uuid,uuid,uuid) TO crest_quote_owner;

DO $extend$ DECLARE signature regprocedure;definition text;updated text;BEGIN
 -- This deliberately fixed field-only profile still refuses every unknown
 -- future table/column, including finance ledgers not yet integrated. It does
 -- not loosen the independent source/export profiles, which remain closed.
 FOREACH signature IN ARRAY ARRAY[
  'crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)'::regprocedure,
  'crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure,
  'crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure
 ] LOOP
  definition:=pg_get_functiondef(signature);
  updated:=replace(definition,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','7d59758a46a631d2ddb9db8df7825aeb77745ba121655b85b4acb87b2748d56b');
  IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 END LOOP;
 definition:=pg_get_functiondef('crest_private.check_booking_plan()'::regprocedure);
 updated:=replace(definition,'SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;',
  'PERFORM crest_private.check_completed_scope_floor(p.business_id,p.source_allocation_id,p.id); SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.amendment_accept_result(uuid,uuid,uuid)'::regprocedure);
 updated:=replace(definition,'  IF (SELECT count(*) FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=plan_row.id)',
  '  PERFORM crest_private.check_completed_scope_floor(business,source.id,plan_row.id); IF (SELECT count(*) FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=plan_row.id)');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_quote_amendment_accept_operation()'::regprocedure);
 updated:=replace(definition,'DECLARE original jsonb;','DECLARE field_original jsonb;original jsonb;');
 updated:=replace(updated,'old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'')',
  'old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'')');
 updated:=replace(updated,'ELSIF retained_job.state=''cancelled'' THEN',$branch$
  ELSIF retained_job.state IN('en_route','in_progress','paused','completed') THEN
   IF retained_job.fulfillment_mode<>'mobile' OR retained_appointment.confirmation_state<>'confirmed'
    OR NOT EXISTS(SELECT 1 FROM crest.schedule_reservations reservation WHERE reservation.business_id=NEW.business_id AND reservation.job_id=retained_job.id AND reservation.appointment_id=retained_appointment.id AND reservation.operator_actor_id=retained_job.operator_actor_id AND reservation.blocked_interval=tstzrange(retained_appointment.start_at-coalesce(retained_appointment.travel_before_seconds,0)*interval '1 second',retained_appointment.end_at+coalesce(retained_appointment.travel_after_seconds,0)*interval '1 second','[)'))
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_SLOT_REQUIRED';END IF;
   IF retained_job.state='completed' THEN
    field_original:=crest_private.completed_job_result(NEW.business_id,retained_job.updated_by,retained_job.operation_id);
    IF retained_job.first_work_at IS NULL OR retained_job.completed_at IS NULL OR retained_job.completion_outcome NOT IN('full','partial')
     OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state='completed')
     OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state NOT IN('completed','cancelled'))
     OR EXISTS(SELECT 1 FROM crest.current_work_intervals WHERE business_id=NEW.business_id AND job_id=retained_job.id AND ended_at IS NULL)
    THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_COMPLETION_REQUIRED';END IF;
   ELSE
    field_original:=crest_private.field_session_result(NEW.business_id,retained_job.updated_by,retained_job.operation_id);
    IF NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state='assigned')
     OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state<>'assigned')
    THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_FIELD_REQUIRED';END IF;
   END IF;
   IF field_original->>'state' IS DISTINCT FROM 'committed' OR field_original->'receipt'->>'jobId' IS DISTINCT FROM retained_job.id::text OR field_original->'receipt'->>'jobVersion' IS DISTINCT FROM retained_job.version::text
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_FIELD_REQUIRED';END IF;
  ELSIF retained_job.state='cancelled' THEN$branch$);
 IF updated=definition OR position('DECLARE field_original jsonb;' IN updated)=0 OR position('CREST_AMENDMENT_RETAINED_COMPLETION_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_amendment_allocation_binding()'::regprocedure);
 updated:=replace(definition,'o.command_type=''quote.amendment.accept'' AND o.schema_version=1 OR',$branch$
  o.command_type='quote.amendment.accept' AND o.schema_version=1 OR
  NEW.authorization_state='active' AND o.command_type='operations.job.complete' AND o.schema_version=1
   AND EXISTS(SELECT 1 FROM crest.allocation_plan_versions prior WHERE prior.business_id=NEW.business_id AND prior.id=NEW.replaces_id AND prior.source_allocation_id=NEW.source_allocation_id AND prior.entitlement_version_id=NEW.entitlement_version_id AND prior.authorization_state=NEW.authorization_state)
  OR$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;
RESET ROLE;
