-- The existing command rechecks these observations under its own locks.
-- This read exposes only the assigned operator's current cancellation facts.
CREATE FUNCTION crest_commands.read_unfulfilled_cancellation_context(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,requested_job uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNFULFILLED_CONTEXT_INPUT_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);

 SELECT jsonb_build_object(
  'schemaVersion',1,'businessId',j.business_id,'jobId',j.id,'jobVersion',j.version::text,'jobState',j.state,
  'workIntervalId',w.id,'openTravelLegVersionIds',travel.ids,'scope',assigned.plans
 ) INTO result
 FROM crest.jobs j
 JOIN crest.current_work_intervals w ON w.business_id=j.business_id AND w.job_id=j.id
  AND w.operator_actor_id=j.operator_actor_id AND w.ended_at IS NULL
  AND w.kind=CASE WHEN j.state='paused' THEN 'pause' ELSE 'active' END
 CROSS JOIN LATERAL (
  SELECT coalesce(jsonb_agg(t.id ORDER BY t.id),'[]'::jsonb) AS ids
  FROM crest.current_travel_legs t WHERE t.business_id=j.business_id
   AND t.operator_actor_id=j.operator_actor_id AND t.state='open'
 ) travel
 CROSS JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
   'sourceAllocationId',s.source_allocation_id,'expectedPlanId',s.plan_id,
   'expectedSequence',s.plan_sequence::text,'entitlementVersionId',s.entitlement_version_id
  ) ORDER BY s.source_allocation_id) AS plans
  FROM (
   SELECT DISTINCT p.source_allocation_id,p.plan_id,p.plan_sequence,p.entitlement_version_id
   FROM crest.current_scope_allocation_parts p
   WHERE p.business_id=j.business_id AND p.job_id=j.id AND p.allocation_state='assigned'
  ) s
 ) assigned
 WHERE j.business_id=requested_business AND j.id=requested_job AND j.operator_actor_id=expected_actor
  AND j.fulfillment_mode='mobile' AND j.state IN('in_progress','paused') AND j.first_work_at IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM crest.work_scope_outcomes o WHERE o.business_id=j.business_id AND o.job_id=j.id)
  AND jsonb_array_length(assigned.plans) BETWEEN 1 AND 1000 AND jsonb_array_length(travel.ids)<=1
  AND crest_private.interruption_scope_valid(j.business_id,j.id,assigned.plans,true);
 IF octet_length(result::text)>1048576 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_UNFULFILLED_CONTEXT_LIMIT';
 END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $read$;

ALTER FUNCTION crest_commands.read_unfulfilled_cancellation_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_unfulfilled_cancellation_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_unfulfilled_cancellation_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

-- Add only recorded communication from the two field cancellation commands.
DO $review$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.read_confirmed_job_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer)') AND p.proowner='crest_booking_owner'::regrole AND p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3239539b6d631203594c80153ad935e4b031176501eeabebc49d005eff849437' AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee NOT IN(p.proowner,'crest_web'::regrole))) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CANCELLATION_HISTORY_SOURCE_REQUIRED';END IF;
END $review$;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_confirmed_job_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,through_version bigint,after_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb;j crest.jobs;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL OR through_version IS NULL OR through_version<1 OR after_version IS NULL OR after_version<0 OR after_version>through_version OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_HISTORY_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;IF j.id IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 IF through_version>j.version THEN RETURN jsonb_build_object('state','conflict','currentVersion',j.version::text);END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.job_events WHERE business_id=requested_business AND job_id=requested_job AND sequence>after_version AND sequence<=through_version ORDER BY sequence LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',requested_job,'throughVersion',through_version::text,'observedVersion',j.version::text,
  'events',coalesce(jsonb_agg(jsonb_build_object('id',p.id,'sequence',p.sequence::text,'operationId',p.operation_id,'actorId',p.created_by,'recordedAt',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'effectiveAt',to_char(p.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'fromState',p.from_state,'toState',p.to_state,'reason',p.reason,
   'action',CASE WHEN p.from_state IS NULL THEN 'book' WHEN p.to_state='cancelled' THEN 'cancel' WHEN p.from_state='scheduled' AND p.to_state='scheduled' AND p.evidence->'request'->'payload'->>'action' IN('propose','confirm','withdraw') THEN p.evidence->'request'->'payload'->>'action' ELSE 'state_change' END,
   'conflictReview',CASE WHEN jsonb_typeof(p.evidence->'request'->'payload'->'conflictReview')='object' THEN jsonb_build_object(
    'appointmentIds',coalesce((SELECT jsonb_agg(x.value ORDER BY x.value) FROM jsonb_array_elements_text(p.evidence->'request'->'payload'->'conflictReview'->'expectedAppointmentIds') x),'[]'::jsonb),
    'unknownTravel',p.evidence->'request'->'payload'->'conflictReview'->'expectedUnknownTravel',
    'unknownTravelReviewed',CASE WHEN p.from_state IS NULL THEN p.evidence->'request'->'payload'->'appointment'->'unknown_travel_reviewed' ELSE p.evidence->'request'->'payload'->'conflictReview'->'unknownTravelReviewed' END,
    'overrideReason',p.evidence->'request'->'payload'->'conflictReview'->'overrideReason') ELSE NULL END,
   'appointment',CASE WHEN a.id IS NULL THEN NULL ELSE crest_private.appointments_projection(a) END,
   'draft',CASE WHEN p.evidence->'confirmationDraft'->>'kind'='appointment_confirmation' THEN jsonb_build_object('state','prepared','appointmentId',p.evidence->'confirmationDraft'->>'appointmentId','confirmationState',p.evidence->'confirmationDraft'->>'confirmationState','bodyText',p.evidence->'confirmationDraft'->>'bodyText') ELSE NULL END,
   'customerCommunication',CASE WHEN p.to_state='cancelled' AND p.evidence->'request'->>'commandType'
    IN('operations.job.interrupt','operations.job.cancel_unfulfilled')
    THEN p.evidence->'request'->'body'->'customerCommunication'
    WHEN p.to_state='cancelled' THEN p.evidence->'request'->'payload'->'customerCommunication' ELSE NULL END
  ) ORDER BY p.sequence),'[]'::jsonb),'hasMore',through_version-after_version>page_limit) INTO result FROM page p LEFT JOIN crest.appointments a ON a.business_id=p.business_id AND a.job_id=p.job_id AND a.operation_id=p.operation_id;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_HISTORY_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN result;
END $history$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
