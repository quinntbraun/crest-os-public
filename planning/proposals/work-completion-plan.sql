-- BR06/BR07 operational completion planning over real, locked allocations.
-- Private construction only: no web grant, source writes, completion, invoice,
-- customer-obligation change or posting is authorized by these functions.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.field_session_result(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('crest_private.load_completion_plans(uuid,uuid)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner') AND a.grantee<>r.oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.load_completion_plans(business uuid,job uuid,requested_plans uuid[]) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $plans$
 SELECT coalesce(jsonb_agg(row_value ORDER BY source_allocation_id),'[]'::jsonb) FROM(
  SELECT v.source_allocation_id,jsonb_build_object('sourceAllocationId',v.source_allocation_id,'planId',v.id,'planSequence',v.sequence::text,'grossInclusiveCents',sum(p.gross_inclusive_cents::numeric)::text,'discountInclusiveCents',sum(p.discount_inclusive_cents::numeric)::text,'amountCents',sum(p.amount_cents::numeric)::text,
   'parts',jsonb_agg(jsonb_build_object('id',p.id,'partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.stable_partition_id)) AS row_value
  FROM crest.allocation_plan_versions v JOIN crest.allocation_plan_parts p ON p.business_id=v.business_id AND p.plan_id=v.id
  WHERE v.business_id=business AND (requested_plans IS NULL AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_versions later WHERE later.business_id=v.business_id AND later.source_allocation_id=v.source_allocation_id AND later.sequence>v.sequence) OR requested_plans IS NOT NULL AND v.id=ANY(requested_plans))
   AND EXISTS(SELECT 1 FROM crest.allocation_plan_parts assigned WHERE assigned.business_id=v.business_id AND assigned.plan_id=v.id AND assigned.job_id=job AND assigned.allocation_state='assigned')
  GROUP BY v.source_allocation_id,v.id,v.sequence
 ) plans
$plans$;
CREATE FUNCTION crest_private.load_completion_plans(business uuid,job uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $latest$ SELECT crest_private.load_completion_plans(business,job,NULL::uuid[]) $latest$;
CREATE FUNCTION crest_private.calculate_completed_scope(business uuid,job uuid,plans jsonb,proposed jsonb,allowed_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $plan$
DECLARE plan jsonb;part jsonb;entry jsonb;piece jsonb;entries jsonb:='{}'::jsonb;used uuid[]:=ARRAY[]::uuid[];known_ids uuid[]:=ARRAY[]::uuid[];all_ids uuid[]:=ARRAY[]::uuid[];new_partition uuid;parts jsonb;new_part jsonb;new_plans jsonb:='[]'::jsonb;outcomes jsonb:='[]'::jsonb;gross numeric;discount numeric;amount numeric;fulfilled bigint:=0;unfulfilled bigint:=0;completed numeric:=0;field text;changed boolean;retained boolean;
BEGIN
 IF business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR nullif(current_setting('crest.actor_id',true),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_CONTEXT_REQUIRED';END IF;
 IF proposed IS NULL OR jsonb_typeof(proposed) IS DISTINCT FROM 'array' OR jsonb_array_length(proposed)=0 OR octet_length(proposed::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(proposed) LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry-ARRAY['assignedPartId','expectedPlanId','expectedPlanSequence','pieces']<>'{}'::jsonb OR NOT entry ?& ARRAY['assignedPartId','expectedPlanId','expectedPlanSequence','pieces']
   OR crest_private.booking_uuid(entry->'assignedPartId') IS NOT TRUE OR crest_private.booking_uuid(entry->'expectedPlanId') IS NOT TRUE OR jsonb_typeof(entry->'expectedPlanSequence') IS DISTINCT FROM 'string' OR (entry->>'expectedPlanSequence')!~'^[1-9][0-9]{0,18}$' OR (entry->>'expectedPlanSequence')::numeric>9223372036854775807
   OR jsonb_typeof(entry->'pieces') IS DISTINCT FROM 'array' OR jsonb_array_length(entry->'pieces')=0 OR entries ? (entry->>'assignedPartId')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
  entries:=entries||jsonb_build_object(entry->>'assignedPartId',entry);
 END LOOP;
 IF plans IS NULL OR jsonb_typeof(plans) IS DISTINCT FROM 'array' OR jsonb_array_length(plans)=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 FOR plan IN SELECT value FROM jsonb_array_elements(plans) LOOP
  FOR part IN SELECT value FROM jsonb_array_elements(plan->'parts') LOOP known_ids:=array_append(known_ids,(part->>'partitionId')::uuid);END LOOP;
 END LOOP;all_ids:=known_ids;
 FOR plan IN SELECT value FROM jsonb_array_elements(plans) LOOP
  IF (plan->>'planSequence')::numeric>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
  parts:='[]'::jsonb;changed:=false;
  FOR part IN SELECT value FROM jsonb_array_elements(plan->'parts') LOOP
   IF part->>'jobId' IS DISTINCT FROM job::text OR part->>'state'<>'assigned' THEN parts:=parts||jsonb_build_array(part-'id');CONTINUE;END IF;
   entry:=entries->(part->>'id');
   IF entry IS NULL OR entry->>'expectedPlanId' IS DISTINCT FROM plan->>'planId' OR entry->>'expectedPlanSequence' IS DISTINCT FROM plan->>'planSequence' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
   used:=array_append(used,(part->>'id')::uuid);gross:=0;discount:=0;amount:=0;retained:=false;changed:=true;
   FOR piece IN SELECT value FROM jsonb_array_elements(entry->'pieces') LOOP
    IF jsonb_typeof(piece) IS DISTINCT FROM 'object' OR piece-ARRAY['partitionId','outcome','scopeDescription','grossInclusiveCents','discountInclusiveCents','amountCents','reason']<>'{}'::jsonb OR NOT piece ?& ARRAY['partitionId','outcome','scopeDescription','grossInclusiveCents','discountInclusiveCents','amountCents','reason']
     OR crest_private.booking_uuid(piece->'partitionId') IS NOT TRUE OR piece->>'outcome' IS NULL OR piece->>'outcome' NOT IN('completed','unfulfilled','cancelled') OR crest_private.booking_text_required(piece->'scopeDescription',2000) IS NOT TRUE
     OR translate(piece->>'scopeDescription',E'\t\n\r','')~'[[:cntrl:]]'
     OR (piece->'reason'<>'null'::jsonb AND(crest_private.booking_text_required(piece->'reason',1000) IS NOT TRUE OR translate(piece->>'reason',E'\t\n\r','')~'[[:cntrl:]]')) OR piece->>'outcome'<>'completed' AND piece->'reason'='null'::jsonb
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
    FOREACH field IN ARRAY ARRAY['grossInclusiveCents','discountInclusiveCents','amountCents'] LOOP
     IF jsonb_typeof(piece->field) IS DISTINCT FROM 'string' OR (piece->>field)!~'^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
     IF (piece->>field)::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
    END LOOP;
    IF (piece->>'grossInclusiveCents')::numeric-(piece->>'discountInclusiveCents')::numeric<>(piece->>'amountCents')::numeric THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
    new_partition:=(piece->>'partitionId')::uuid;
    IF new_partition=(part->>'partitionId')::uuid THEN IF retained THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;retained:=true;
    ELSIF new_partition=ANY(all_ids) OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts historical WHERE historical.business_id=business AND historical.stable_partition_id=new_partition AND (allowed_operation IS NULL OR historical.operation_id<>allowed_operation)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';
    ELSE all_ids:=array_append(all_ids,new_partition);END IF;
    gross:=gross+(piece->>'grossInclusiveCents')::numeric;discount:=discount+(piece->>'discountInclusiveCents')::numeric;amount:=amount+(piece->>'amountCents')::numeric;
    IF piece->>'outcome'='completed' THEN fulfilled:=fulfilled+1;completed:=completed+(piece->>'amountCents')::numeric;ELSE unfulfilled:=unfulfilled+1;END IF;
    new_part:=jsonb_build_object('partitionId',new_partition,'jobId',job,'state',CASE WHEN piece->>'outcome'='completed' THEN 'completed' ELSE 'cancelled' END,'grossInclusiveCents',piece->'grossInclusiveCents','discountInclusiveCents',piece->'discountInclusiveCents','amountCents',piece->'amountCents','scopeDescription',piece->'scopeDescription');parts:=parts||jsonb_build_array(new_part);
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('assignedPartId',part->>'id','partitionId',new_partition,'outcome',piece->>'outcome','scopeDescription',piece->>'scopeDescription','completedCents',CASE WHEN piece->>'outcome'='completed' THEN piece->>'amountCents' ELSE '0' END,'reason',piece->'reason'));
   END LOOP;
   IF NOT retained OR gross<>(part->>'grossInclusiveCents')::numeric OR discount<>(part->>'discountInclusiveCents')::numeric OR amount<>(part->>'amountCents')::numeric THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
  END LOOP;
  IF NOT changed THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
  new_plans:=new_plans||jsonb_build_array(jsonb_build_object('sourceAllocationId',plan->'sourceAllocationId','expectedPlanId',plan->'planId','expectedPlanSequence',plan->'planSequence','parts',parts));
 END LOOP;
 IF cardinality(used)<>jsonb_array_length(proposed) OR fulfilled=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('completionOutcome',CASE WHEN unfulfilled>0 THEN 'partial' ELSE 'full' END,'needsCommercialResolution',unfulfilled>0,'completedCents',completed::text,'fulfilledPortions',fulfilled,'unfulfilledPortions',unfulfilled,'plans',new_plans,'outcomes',outcomes);
END $plan$;
CREATE FUNCTION crest_private.plan_completed_scope(business uuid,job uuid,expected_version bigint,proposed jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $locked$
DECLARE j crest.jobs;family uuid;
BEGIN
 IF business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR nullif(current_setting('crest.actor_id',true),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_CONTEXT_REQUIRED';END IF;
 IF expected_version IS NULL OR expected_version<1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||business::text,0));
 FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=business AND job_id=job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(business,family);END LOOP;
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;
 IF j.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 PERFORM crest_private.lock_booking_operator(business,j.operator_actor_id);
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job FOR UPDATE;
 IF j.version<>expected_version OR j.state NOT IN('in_progress','paused') OR j.first_work_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 RETURN crest_private.calculate_completed_scope(business,job,crest_private.load_completion_plans(business,job),proposed,NULL);
END $locked$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.load_completion_plans(uuid,uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.load_completion_plans(uuid,uuid,uuid[]) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.calculate_completed_scope(uuid,uuid,jsonb,jsonb,uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.plan_completed_scope(uuid,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.load_completion_plans(uuid,uuid),crest_private.plan_completed_scope(uuid,uuid,bigint,jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION crest_private.load_completion_plans(uuid,uuid,uuid[]),crest_private.calculate_completed_scope(uuid,uuid,jsonb,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.load_completion_plans(uuid,uuid,uuid[]),crest_private.calculate_completed_scope(uuid,uuid,jsonb,jsonb,uuid) TO crest_booking_integrity_owner;
