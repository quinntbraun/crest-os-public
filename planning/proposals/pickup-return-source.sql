-- Held after pickup-custody-release.sql. Keep the registered v1 source intact.
RESET ROLE;
DO $review$
DECLARE routine record; source text; changed text; edit record;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='crest_private.pickup_custody_releases'::regclass
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity
  AND NOT has_table_privilege('crest_web',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_SOURCE_REVIEW_REQUIRED'; END IF;
 FOR routine IN SELECT * FROM (VALUES
  ('crest_private.pickup_custody_source_rows(uuid,text)',1),
  ('crest_commands.pickup_custody_source_context(uuid)',2),
  ('crest_commands.pickup_custody_source_page(uuid,text,text,uuid,integer)',3)
 ) AS routines(signature,kind)
 LOOP
  SELECT pg_get_functiondef(p.oid) INTO STRICT source FROM pg_proc p
  WHERE p.oid=to_regprocedure(routine.signature) AND p.proowner='crest_booking_integrity_owner'::regrole
   AND p.prosecdef AND p.proconfig @> ARRAY['row_security=on'];
  FOR edit IN SELECT * FROM (VALUES
   (1,$old$'arrival_version_id',p.arrival_version_id,'policy_id',p.policy_id,'job_version',p.job_version::text,$old$,
      $new$'arrival_version_id',p.arrival_version_id,'policy_id',p.policy_id,'job_version',p.job_version::text,
  'return_collection_id',p.return_collection_id,$new$),
   (1,$old$FROM crest_private.vehicle_custody_claims p WHERE requested_group='vehicle_custody_claims' AND p.business_id=requested_business$old$,
      $new$FROM crest_private.vehicle_custody_claims p WHERE requested_group='vehicle_custody_claims' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,'business_id',p.business_id,'collection_id',p.collection_id,'job_id',p.job_id,
  'job_vehicle_id',p.job_vehicle_id,'vehicle_id',p.vehicle_id,'policy_id',p.policy_id,
  'return_leg_version_id',p.return_leg_version_id,'job_version',p.job_version::text,
  'effective_at',to_char(p.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'person_snapshot',p.person_snapshot::text,'location_snapshot',p.location_snapshot::text,
  'notes',p.notes,'missing_photo_reason',p.missing_photo_reason,'condition_photo_id',p.condition_photo_id,
  'acknowledgement_confirmed',p.acknowledgement_confirmed,'created_by',p.created_by,'operation_id',p.operation_id)
 FROM crest_private.pickup_custody_releases p
 WHERE requested_group='pickup_custody_releases' AND p.business_id=requested_business$new$),
   (2,$old$UNION ALL SELECT 'vehicle_custody_claims',count(*) FROM crest_private.vehicle_custody_claims WHERE business_id=requested_business$old$,
      $new$UNION ALL SELECT 'vehicle_custody_claims',count(*) FROM crest_private.vehicle_custody_claims WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_custody_releases',count(*) FROM crest_private.pickup_custody_releases WHERE business_id=requested_business$new$),
   (2,$old$'schemaVersion',1,'profile','crest.pickup-custody-source.v1'$old$,
      $new$'schemaVersion',2,'profile','crest.pickup-custody-source.v2'$new$),
   (2,$old$'crest.pickup-custody-source/1'$old$,$new$'crest.pickup-custody-source/2'$new$),
   (3,$old$'schemaVersion',1,'businessId',requested_business$old$,$new$'schemaVersion',2,'businessId',requested_business$new$)
  ) AS edits(kind,before,after) WHERE edits.kind=routine.kind
  LOOP
   changed:=replace(source,edit.before,edit.after);
   IF length(source)-length(replace(source,edit.before,''))<>length(edit.before)
   THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_SOURCE_REVIEW_REQUIRED'; END IF;
   source:=changed;
  END LOOP;
  EXECUTE source;
 END LOOP;
END $review$;
