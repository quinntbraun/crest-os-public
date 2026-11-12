-- Held pickup source capture. Shared photo byte metadata stays in the existing
-- custody inventory and is joined through the immutable pickup slot.
RESET ROLE;
DO $review$ BEGIN
 IF EXISTS(SELECT FROM (VALUES ('pickup_custody_policies'),('pickup_job_policies'),('pickup_custody_collections'),
  ('pickup_photo_slots'),('vehicle_custody_claims')) expected(name)
  LEFT JOIN pg_class c ON c.oid=to_regclass('crest_private.'||expected.name)
  WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity)
   OR has_table_privilege('crest_web',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
   OR has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 THEN RAISE EXCEPTION 'CREST_PICKUP_SOURCE_REVIEW_REQUIRED'; END IF;
END $review$;

CREATE FUNCTION crest_private.pickup_custody_source_rows(requested_business uuid,requested_group text)
 RETURNS TABLE(row_id uuid,row_value jsonb) LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $rows$
 SELECT p.id,jsonb_build_object(
  'id',p.id,'business_id',p.business_id,'mode_version_id',p.mode_version_id,'sequence',p.sequence::text,
  'replaces_sequence',p.replaces_sequence::text,'reason',p.reason,'created_by',p.created_by,
  'acknowledgement_text',p.acknowledgement_text,'condition_photo_required',p.condition_photo_required,
  'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
 FROM crest_private.pickup_custody_policies p WHERE requested_group='pickup_custody_policies' AND p.business_id=requested_business
 UNION ALL
 SELECT p.job_id,jsonb_build_object('business_id',p.business_id,'job_id',p.job_id,'policy_id',p.policy_id)
 FROM crest_private.pickup_job_policies p WHERE requested_group='pickup_job_policies' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,'business_id',p.business_id,'job_id',p.job_id,'job_vehicle_id',p.job_vehicle_id,'vehicle_id',p.vehicle_id,
  'pickup_leg_version_id',p.pickup_leg_version_id,'policy_id',p.policy_id,
  'effective_at',to_char(p.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'person_snapshot',p.person_snapshot::text,'location_snapshot',p.location_snapshot::text,'notes',p.notes,
  'missing_photo_reason',p.missing_photo_reason,'condition_photo_id',p.condition_photo_id,
  'acknowledgement_confirmed',p.acknowledgement_confirmed,'created_by',p.created_by,'operation_id',p.operation_id)
 FROM crest_private.pickup_custody_collections p WHERE requested_group='pickup_custody_collections' AND p.business_id=requested_business
 UNION ALL
 SELECT p.photo_id,jsonb_build_object(
  'business_id',p.business_id,'photo_id',p.photo_id,'job_id',p.job_id,'job_vehicle_id',p.job_vehicle_id,'collection_id',p.collection_id,
  'arrival_version_id',p.arrival_version_id,'policy_id',p.policy_id,'job_version',p.job_version::text,
  'actor_id',p.actor_id,'recovery_epoch',p.recovery_epoch)
 FROM crest_private.pickup_photo_slots p WHERE requested_group='pickup_photo_slots' AND p.business_id=requested_business
 UNION ALL
 SELECT p.vehicle_id,jsonb_build_object(
  'business_id',p.business_id,'vehicle_id',p.vehicle_id,'dropoff_case_id',p.dropoff_case_id,'pickup_collection_id',p.pickup_collection_id)
 FROM crest_private.vehicle_custody_claims p WHERE requested_group='vehicle_custody_claims' AND p.business_id=requested_business
$rows$;

CREATE FUNCTION crest_commands.pickup_custody_source_context(requested_business uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE history jsonb; counts jsonb; total bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_PICKUP_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_SOURCE_SCOPE_REQUIRED'; END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 SELECT jsonb_object_agg(name,rows::text),sum(rows) INTO counts,total FROM (
  SELECT 'pickup_custody_policies' AS name,count(*) AS rows FROM crest_private.pickup_custody_policies WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_job_policies',count(*) FROM crest_private.pickup_job_policies WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_custody_collections',count(*) FROM crest_private.pickup_custody_collections WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_photo_slots',count(*) FROM crest_private.pickup_photo_slots WHERE business_id=requested_business
  UNION ALL SELECT 'vehicle_custody_claims',count(*) FROM crest_private.vehicle_custody_claims WHERE business_id=requested_business
 ) counted;
 IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PICKUP_SOURCE_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'profile','crest.pickup-custody-source.v1','businessId',requested_business,
  'snapshotToken',encode(sha256(convert_to(jsonb_build_array('crest.pickup-custody-source/1',requested_business,pg_current_snapshot()::text)::text,'UTF8')),'hex'),
  'historySnapshotToken',history->>'snapshotToken','expectedCounts',counts);
END $context$;

CREATE FUNCTION crest_commands.pickup_custody_source_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.pickup_custody_source_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR requested_group IS NULL
  OR NOT (context->'expectedCounts') ? requested_group OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_SOURCE_PAGE_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(
  SELECT row_id,row_value FROM crest_private.pickup_custody_source_rows(requested_business,requested_group)
  WHERE after_id IS NULL OR row_id>after_id ORDER BY row_id LIMIT page_limit+1
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'group',requested_group,
  'hasMore',(SELECT count(*)>page_limit FROM page),'rows',coalesce(jsonb_agg(row_value ORDER BY row_id),'[]'::jsonb))
 INTO result FROM (SELECT * FROM page ORDER BY row_id LIMIT page_limit) shown;
 RETURN result;
END $page$;

GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.pickup_custody_source_rows(uuid,text) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.pickup_custody_source_context(uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.pickup_custody_source_page(uuid,text,text,uuid,integer) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_custody_source_rows(uuid,text),crest_commands.pickup_custody_source_context(uuid),
 crest_commands.pickup_custody_source_page(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;
