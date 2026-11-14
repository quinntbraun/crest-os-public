-- P10/BR10 private task lists and exact lookup of a committed maintenance action.
-- Held reader. The ordinary runtime receives no grant until reviewed adoption.
CREATE FUNCTION crest_commands.list_maintenance_follow_ups(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 scope_kind text,scope_id uuid,through_at timestamptz,after_due_at timestamptz,after_task_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE authority jsonb; page jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF scope_kind IS NULL OR scope_kind NOT IN ('due','customer','job')
  OR ((scope_kind='due')<>(scope_id IS NULL)) OR ((scope_kind='due')<>(through_at IS NOT NULL))
  OR ((after_due_at IS NULL)<>(after_task_id IS NULL))
  OR (through_at IS NOT NULL AND NOT isfinite(through_at)) OR (after_due_at IS NOT NULL AND NOT isfinite(after_due_at))
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_LIST_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 WITH bounded AS MATERIALIZED (
  SELECT t.id,t AS task,head.event,c.display_name,v.label,coalesce(head.snoozed_until,t.due_at) AS due
  FROM crest.follow_up_tasks t
  JOIN crest.customers c ON c.business_id=t.business_id AND c.id=t.customer_id
  LEFT JOIN crest.vehicles v ON v.business_id=t.business_id AND v.id=t.vehicle_id
  JOIN LATERAL (
   SELECT e AS event,e.kind,e.snoozed_until FROM crest.follow_up_task_events e
   WHERE e.business_id=t.business_id AND e.task_id=t.id ORDER BY e.version DESC LIMIT 1
  ) head ON true
  WHERE t.business_id=requested_business
   AND ((scope_kind='due' AND head.kind IN ('created','snoozed') AND coalesce(head.snoozed_until,t.due_at)<through_at)
     OR (scope_kind='customer' AND t.customer_id=scope_id) OR (scope_kind='job' AND t.source_job_id=scope_id))
   AND (after_task_id IS NULL OR (coalesce(head.snoozed_until,t.due_at),t.id)>(after_due_at,after_task_id))
  ORDER BY due,t.id LIMIT 21
 ), ordered AS (
  SELECT b.*,row_number() OVER (ORDER BY b.due,b.id) AS position FROM bounded b
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'scopeKind',scope_kind,'scopeId',scope_id,
  'throughAt',to_char(through_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'entries',coalesce(jsonb_agg(jsonb_build_object(
    'record',crest_private.follow_up_snapshot(o.task,o.event),'customerName',o.display_name,'vehicleLabel',o.label,
    'effectiveDueAt',to_char(o.due AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
   ) ORDER BY o.position) FILTER (WHERE o.position<=20),'[]'::jsonb),
  'next',CASE WHEN count(*)=21 THEN (
   SELECT jsonb_build_object('taskId',last.id,'effectiveDueAt',to_char(last.due AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
   FROM ordered last WHERE last.position=20
  ) END)
 INTO page FROM ordered o;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN page;
END $list$;
ALTER FUNCTION crest_commands.list_maintenance_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,timestamptz,uuid)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.list_maintenance_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,timestamptz,uuid) FROM PUBLIC;

CREATE FUNCTION crest_commands.lookup_maintenance_follow_up(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_task uuid,expected_version bigint,expected_kind text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE authority jsonb; saved record; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF expected_epoch IS NULL OR requested_operation IS NULL OR requested_task IS NULL
  OR expected_version IS NULL OR expected_version<0 OR expected_version=9223372036854775807
  OR coalesce(expected_kind,'') NOT IN ('created','snoozed','completed','dismissed') OR (expected_kind='created')<>(expected_version=0)
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_ORIGINAL_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT o.recovery_epoch,o.result->'request' AS request INTO saved
 FROM crest_private.operations o WHERE o.business_id=requested_business AND o.actor_id=expected_actor
  AND o.operation_id=requested_operation AND o.command_type='operations.follow_up.save' AND o.state='committed';
 IF FOUND AND saved.recovery_epoch=expected_epoch AND saved.request->>'taskId'=requested_task::text
  AND saved.request->>'expectedVersion'=expected_version::text AND saved.request->'body'->>'kind'=expected_kind
 THEN
  result:=crest_private.follow_up_result(requested_business,expected_actor,requested_operation);
  IF result->>'state' IS DISTINCT FROM 'committed'
  THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_FOLLOW_UP_RESULT_REQUIRED';END IF;
 END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text) FROM PUBLIC;
