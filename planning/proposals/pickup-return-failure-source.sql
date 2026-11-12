-- Held after pickup-return-source.sql and pickup-return-failure.sql.
-- The v3 source adds unresolved and historical failed-arrival evidence.
RESET ROLE;
DO $review$
DECLARE routine record; source text; edit record;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='crest_private.pickup_return_failures'::regclass
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity
  AND NOT has_table_privilege('crest_web',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_SOURCE_REVIEW_REQUIRED'; END IF;
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
   (1,$old$WHERE requested_group='pickup_custody_releases' AND p.business_id=requested_business$old$,
      $new$WHERE requested_group='pickup_custody_releases' AND p.business_id=requested_business
 UNION ALL
 SELECT f.id,crest_private.pickup_return_failure_image(f)
 FROM crest_private.pickup_return_failures f
 WHERE requested_group='pickup_return_failures' AND f.business_id=requested_business$new$),
   (2,$old$UNION ALL SELECT 'pickup_custody_releases',count(*) FROM crest_private.pickup_custody_releases WHERE business_id=requested_business$old$,
      $new$UNION ALL SELECT 'pickup_custody_releases',count(*) FROM crest_private.pickup_custody_releases WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_return_failures',count(*) FROM crest_private.pickup_return_failures WHERE business_id=requested_business$new$),
   (2,$old$'schemaVersion',2,'profile','crest.pickup-custody-source.v2'$old$,
      $new$'schemaVersion',3,'profile','crest.pickup-custody-source.v3'$new$),
   (2,$old$'crest.pickup-custody-source/2'$old$,$new$'crest.pickup-custody-source/3'$new$),
   (3,$old$'schemaVersion',2,'businessId',requested_business$old$,$new$'schemaVersion',3,'businessId',requested_business$new$)
  ) AS edits(kind,before,after) WHERE edits.kind=routine.kind
  LOOP
   IF length(source)-length(replace(source,edit.before,''))<>length(edit.before)
   THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_SOURCE_REVIEW_REQUIRED'; END IF;
   source:=replace(source,edit.before,edit.after);
  END LOOP;
  EXECUTE source;
 END LOOP;
END $review$;
