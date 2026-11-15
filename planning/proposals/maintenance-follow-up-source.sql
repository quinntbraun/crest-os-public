-- Held maintenance source collector. Expose two fixed projections only in a
-- single repeatable-read, read-only export snapshot. Runtime roles stay closed.
DO $review$
BEGIN
 IF to_regprocedure('crest_commands.maintenance_follow_up_source_context(uuid)') IS NOT NULL
  OR to_regprocedure('crest_private.follow_up_result(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('crest_commands.business_history_export_context(uuid)') IS NULL
  OR EXISTS(
   SELECT 1 FROM (VALUES('crest.follow_up_tasks'),('crest.follow_up_task_events')) AS targets(name)
   LEFT JOIN pg_class c ON c.oid=to_regclass(targets.name)
   WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole
    OR NOT(c.relrowsecurity AND c.relforcerowsecurity)
    OR has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  )
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FOLLOW_UP_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE FUNCTION crest_commands.maintenance_follow_up_source_context(requested_business uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE history jsonb; roots bigint; events bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_FOLLOW_UP_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FOLLOW_UP_SOURCE_SCOPE_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 SELECT count(*) INTO roots FROM crest.follow_up_tasks WHERE business_id=requested_business;
 SELECT count(*) INTO events FROM crest.follow_up_task_events WHERE business_id=requested_business;
 IF roots+events>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_FOLLOW_UP_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'profile','crest.maintenance-follow-up-source.v1',
  'businessId',requested_business,'snapshotToken',encode(sha256(convert_to(
   jsonb_build_array('crest.maintenance-follow-up-source/1',requested_business,pg_current_snapshot()::text)::text,'UTF8')),'hex'),
  'historySnapshotToken',history->>'snapshotToken','expectedCounts',
  jsonb_build_object('follow_up_tasks',roots::text,'follow_up_task_events',events::text));
END $context$;

CREATE FUNCTION crest_commands.maintenance_follow_up_source_page(
 requested_business uuid,expected_snapshot text,requested_group text,after_id uuid,page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; rows jsonb; last_id uuid; has_more boolean; invalid boolean;
BEGIN
 context:=crest_commands.maintenance_follow_up_source_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR requested_group IS NULL
  OR requested_group NOT IN ('follow_up_tasks','follow_up_task_events') OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FOLLOW_UP_SOURCE_PAGE_REQUIRED';END IF;
 IF requested_group='follow_up_tasks' THEN
  WITH page AS MATERIALIZED(
   SELECT * FROM crest.follow_up_tasks WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id)
   ORDER BY id LIMIT page_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'business_id',p.business_id,'customer_id',p.customer_id,'vehicle_id',p.vehicle_id,'source_job_id',p.source_job_id,
   'due_at',to_char(p.due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'created_at',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'created_by',p.created_by,'operation_id',p.operation_id,'origin',p.origin) ORDER BY p.id),'[]'::jsonb),
   (SELECT id FROM page ORDER BY id DESC LIMIT 1),
   coalesce(bool_or(crest_private.follow_up_result(p.business_id,p.created_by,p.operation_id)->>'state' IS DISTINCT FROM 'committed'),false)
  INTO rows,last_id,invalid FROM page p;
  SELECT EXISTS(SELECT 1 FROM crest.follow_up_tasks WHERE business_id=requested_business AND id>last_id) INTO has_more;
 ELSE
  WITH page AS MATERIALIZED(
   SELECT * FROM crest.follow_up_task_events WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id)
   ORDER BY id LIMIT page_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'business_id',p.business_id,'task_id',p.task_id,'version',p.version::text,'prior_version',p.prior_version::text,
   'kind',p.kind,'snoozed_until',to_char(p.snoozed_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'rebooking_job_id',p.rebooking_job_id,'reason',p.reason,
   'created_at',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'created_by',p.created_by,'operation_id',p.operation_id,'origin',p.origin) ORDER BY p.id),'[]'::jsonb),
   (SELECT id FROM page ORDER BY id DESC LIMIT 1),
   coalesce(bool_or(crest_private.follow_up_result(p.business_id,p.created_by,p.operation_id)->>'state' IS DISTINCT FROM 'committed'),false)
  INTO rows,last_id,invalid FROM page p;
  SELECT EXISTS(SELECT 1 FROM crest.follow_up_task_events WHERE business_id=requested_business AND id>last_id) INTO has_more;
 END IF;
 IF invalid THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FOLLOW_UP_SOURCE_HISTORY_REQUIRED';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,
  'group',requested_group,'rows',rows,'hasMore',has_more);
END $page$;

GRANT CREATE ON SCHEMA crest_commands TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.maintenance_follow_up_source_context(uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.maintenance_follow_up_source_page(uuid,text,text,uuid,integer) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_commands.maintenance_follow_up_source_context(uuid),
 crest_commands.maintenance_follow_up_source_page(uuid,text,text,uuid,integer) FROM PUBLIC;
