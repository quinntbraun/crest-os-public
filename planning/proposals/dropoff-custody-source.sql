-- Held custody source reader. Fixed physical columns, original JSON text and
-- exact timestamps are exposed only inside a repeatable-read read-only snapshot.
-- Runtime and general export roles receive no entry point in this proposal.
DO $review$
BEGIN
 IF to_regprocedure('crest_private.dropoff_custody_source_rows(uuid,text)') IS NOT NULL
  OR to_regprocedure('crest_commands.business_history_export_context(uuid)') IS NULL
  OR EXISTS(SELECT 1 FROM (VALUES ('crest.custody_authorization_configs'),('crest.custody_cases'),('crest.custody_events'),('crest.custody_photo_attempts'),('crest.custody_photo_originals')) expected(name)
   LEFT JOIN pg_class c ON c.oid=to_regclass(expected.name)
   WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity)
    OR has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE FUNCTION crest_private.dropoff_custody_source_rows(requested_business uuid,requested_group text)
 RETURNS TABLE(row_id uuid,row_value jsonb) LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $rows$
 SELECT p.id,jsonb_build_object(
  'id',p.id,
  'business_id',p.business_id,
  'mode_version_id',p.mode_version_id,
  'acknowledgement_text',p.acknowledgement_text,
  'condition_photo_required',p.condition_photo_required
 ) FROM crest.custody_authorization_configs p WHERE requested_group='custody_authorization_configs' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,
  'business_id',p.business_id,
  'job_id',p.job_id,
  'job_vehicle_id',p.job_vehicle_id,
  'vehicle_id',p.vehicle_id,
  'mode',p.mode,
  'version',p.version::text,
  'state',p.state,
  'current_event_id',p.current_event_id,
  'authorization_config_id',p.authorization_config_id
 ) FROM crest.custody_cases p WHERE requested_group='custody_cases' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,
  'business_id',p.business_id,
  'case_id',p.case_id,
  'version',p.version::text,
  'prior_version',p.prior_version::text,
  'action',p.action,
  'effective_at',to_char(p.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'person_snapshot',p.person_snapshot::text,
  'location_snapshot',p.location_snapshot::text,
  'notes',p.notes,
  'missing_photo_reason',p.missing_photo_reason,
  'created_by',p.created_by,
  'operation_id',p.operation_id,
  'origin',p.origin,
  'acknowledgement_confirmed',p.acknowledgement_confirmed,
  'condition_photo_id',p.condition_photo_id
 ) FROM crest.custody_events p WHERE requested_group='custody_events' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,
  'business_id',p.business_id,
  'job_id',p.job_id,
  'job_vehicle_id',p.job_vehicle_id,
  'vehicle_id',p.vehicle_id,
  'case_id',p.case_id,
  'handoff_version',p.handoff_version,
  'actor_id',p.actor_id,
  'recovery_epoch',p.recovery_epoch,
  'dispatch_id',p.dispatch_id,
  'declared_type',p.declared_type,
  'byte_size',p.byte_size,
  'reserved_at',to_char(p.reserved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 ) FROM crest.custody_photo_attempts p WHERE requested_group='custody_photo_attempts' AND p.business_id=requested_business
 UNION ALL
 SELECT p.photo_id,jsonb_build_object(
  'business_id',p.business_id,
  'photo_id',p.photo_id,
  'detected_type',p.detected_type,
  'byte_size',p.byte_size,
  'sha256',p.sha256,
  'validation_version',p.validation_version,
  'width',p.width,
  'height',p.height,
  'display_width',p.display_width,
  'display_height',p.display_height,
  'bit_depth',p.bit_depth,
  'preview_sha256',p.preview_sha256,
  'preview_byte_size',p.preview_byte_size,
  'preview_width',p.preview_width,
  'preview_height',p.preview_height,
  'verified_at',to_char(p.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 ) FROM crest.custody_photo_originals p WHERE requested_group='custody_photo_originals' AND p.business_id=requested_business
$rows$;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.dropoff_custody_source_rows(uuid,text) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.dropoff_custody_source_rows(uuid,text) FROM PUBLIC;

CREATE FUNCTION crest_commands.dropoff_custody_source_context(requested_business uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE history jsonb; counts jsonb; total bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CUSTODY_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_SOURCE_SCOPE_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 SELECT jsonb_object_agg(name,rows::text),sum(rows) INTO counts,total FROM (
  SELECT 'custody_authorization_configs' AS name,count(*) AS rows FROM crest.custody_authorization_configs WHERE business_id=requested_business
  UNION ALL
  SELECT 'custody_cases' AS name,count(*) AS rows FROM crest.custody_cases WHERE business_id=requested_business
  UNION ALL
  SELECT 'custody_events' AS name,count(*) AS rows FROM crest.custody_events WHERE business_id=requested_business
  UNION ALL
  SELECT 'custody_photo_attempts' AS name,count(*) AS rows FROM crest.custody_photo_attempts WHERE business_id=requested_business
  UNION ALL
  SELECT 'custody_photo_originals' AS name,count(*) AS rows FROM crest.custody_photo_originals WHERE business_id=requested_business
 ) counted;
 IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CUSTODY_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'profile','crest.dropoff-custody-source.v1','businessId',requested_business,
  'snapshotToken',encode(sha256(convert_to(jsonb_build_array('crest.dropoff-custody-source/1',requested_business,pg_current_snapshot()::text)::text,'UTF8')),'hex'),
  'historySnapshotToken',history->>'snapshotToken','expectedCounts',counts);
END $context$;

CREATE FUNCTION crest_commands.dropoff_custody_source_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.dropoff_custody_source_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR requested_group IS NULL
  OR requested_group NOT IN('custody_authorization_configs','custody_cases','custody_events','custody_photo_attempts','custody_photo_originals') OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_SOURCE_PAGE_REQUIRED';END IF;
 WITH page AS MATERIALIZED(
  SELECT row_id,row_value FROM crest_private.dropoff_custody_source_rows(requested_business,requested_group)
  WHERE after_id IS NULL OR row_id>after_id ORDER BY row_id LIMIT page_limit+1
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'group',requested_group,
  'hasMore',(SELECT count(*)>page_limit FROM page),'rows',coalesce(jsonb_agg(row_value ORDER BY row_id),'[]'::jsonb))
 INTO result FROM (SELECT * FROM page ORDER BY row_id LIMIT page_limit) shown;
 RETURN result;
END $page$;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.dropoff_custody_source_context(uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.dropoff_custody_source_page(uuid,text,text,uuid,integer) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_commands.dropoff_custody_source_context(uuid),
 crest_commands.dropoff_custody_source_page(uuid,text,text,uuid,integer) FROM PUBLIC;
