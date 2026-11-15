-- Private read for the Mobile completion editor, after the registered field workspace.
-- The existing complete_job command retains all locking and write authority.
DO $preflight$
BEGIN
 IF to_regclass('crest.work_scope_outcomes') IS NULL
    OR to_regprocedure('crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='CREST_COMPLETION_CONTEXT_REQUIRES_FIELD_SCHEMA'; END IF;
END $preflight$;

CREATE FUNCTION crest_commands.read_job_completion_context(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_job uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_COMPLETION_CONTEXT_INPUT_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 -- The job version, customer version and current allocation parts are from
 -- one statement snapshot. The command checks them again under its locks.
 SELECT jsonb_build_object(
  'schemaVersion',1,'businessId',j.business_id,'jobId',j.id,'jobVersion',j.version::text,
  'jobState',j.state,'customerVersion',c.version::text,'assignments',scope.assignments,
  'duplicateRequestIds',duplicates.ids,'contactReviewRequired',c.contact_preference IS NOT NULL
 ) INTO result
 FROM crest.jobs j
 JOIN crest.customers c ON c.business_id=j.business_id AND c.id=j.customer_id
 CROSS JOIN LATERAL (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'assignedPartId',p.id,'partitionId',p.stable_partition_id,'planId',s.plan_id,
   'planSequence',s.plan_sequence::text,'scopeDescription',p.scope_description,
   'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,
   'amountCents',p.amount_cents::text
  ) ORDER BY s.source_allocation_id,p.stable_partition_id),'[]'::jsonb) AS assignments
  FROM crest.current_scope_allocation_parts s
  JOIN crest.allocation_plan_parts p ON p.business_id=s.business_id
   AND p.plan_id=s.plan_id AND p.stable_partition_id=s.stable_partition_id AND p.job_id=s.job_id
  WHERE s.business_id=j.business_id AND s.job_id=j.id AND s.allocation_state='assigned'
 ) scope
 CROSS JOIN LATERAL (
  SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) AS ids FROM (
   SELECT DISTINCT r.id FROM crest.review_requests r
   JOIN crest.review_request_encounters b ON b.business_id=r.business_id AND b.request_id=r.id
   JOIN crest.job_encounters old_encounter ON old_encounter.business_id=b.business_id AND old_encounter.id=b.job_encounter_id
   JOIN crest.job_encounters encounter ON encounter.business_id=old_encounter.business_id
    AND encounter.encounter_id=old_encounter.encounter_id
   WHERE r.business_id=j.business_id AND r.customer_id=j.customer_id AND r.job_id<>j.id AND encounter.job_id=j.id
  ) previous
 ) duplicates
 WHERE j.business_id=requested_business AND j.id=requested_job
  AND j.fulfillment_mode='mobile' AND j.state IN('in_progress','paused');
 IF result IS NOT NULL AND jsonb_array_length(result->'assignments')=0 THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_COMPLETION_CONTEXT_REQUIRES_SCOPE';
 END IF;
 IF result IS NULL THEN
  SELECT jsonb_build_object(
   'schemaVersion',1,'businessId',j.business_id,'jobId',j.id,'jobVersion',j.version::text,'jobState',j.state,
   'completedAt',to_char(j.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'completionOutcome',j.completion_outcome,'walkthrough',e.evidence->'request'->'body'->'walkthrough',
   'reason',e.reason,'outcomes',outcomes.rows,
   'review',jsonb_build_object('state',r.state,'suppressionReason',r.suppression_reason,'reason',r.reason,
    'message',CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object('channel',m.channel,'text',m.body_snapshot) END),
   'tasks',tasks.rows
  ) INTO result
  FROM crest.jobs j
  JOIN crest.review_requests r ON r.business_id=j.business_id AND r.job_id=j.id AND r.is_primary
  JOIN crest.job_events e ON e.business_id=j.business_id AND e.job_id=j.id
   AND e.operation_id=r.operation_id AND e.to_state='completed'
  LEFT JOIN crest.messages m ON m.business_id=r.business_id AND m.job_id=r.job_id AND m.id=r.message_id
  CROSS JOIN LATERAL (
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'outcome',o.outcome,'scopeDescription',o.scope_description,
    'completedCents',o.completed_cents::text,'reason',o.reason) ORDER BY o.assigned_part_id,o.partition_id),'[]'::jsonb) AS rows
   FROM crest.work_scope_outcomes o WHERE o.business_id=j.business_id AND o.job_id=j.id AND o.operation_id=e.operation_id
  ) outcomes
  CROSS JOIN LATERAL (
   SELECT coalesce(jsonb_agg(jsonb_build_object('kind',t.kind,'state',t.state) ORDER BY t.kind),'[]'::jsonb) AS rows
   FROM crest.job_finalization_tasks t WHERE t.business_id=j.business_id AND t.job_id=j.id AND t.operation_id=e.operation_id
  ) tasks
  WHERE j.business_id=requested_business AND j.id=requested_job AND j.fulfillment_mode='mobile' AND j.state='completed';
 END IF;
 IF octet_length(result::text)>1048576 THEN
  RAISE EXCEPTION USING ERRCODE='54000', MESSAGE='CREST_COMPLETION_CONTEXT_LIMIT';
 END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $read$;

ALTER FUNCTION crest_commands.read_job_completion_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_job_completion_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_job_completion_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
