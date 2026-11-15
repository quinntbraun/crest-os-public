-- Held schema66 extension after custody work/completion, before schema compatibility.
-- Reuse the existing explicit no-fulfilled-work cancellation. Close only the work
-- interval; vehicle custody and its separate return obligation remain unchanged.
DO $review$
DECLARE entry record; routine regprocedure; definition text; old_acl aclitem[];
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner','v','5d15ddc9cc24047ed838296197a45a313591550b60f2cf87cd1e236c36910d2c','before_job.fulfillment_mode<>''mobile''','before_job.fulfillment_mode NOT IN(''mobile'',''dropoff'')'),
  ('crest_private.field_source_stamp()','crest_booking_integrity_owner','v','592a9dc66724f982336d603fe6615918891e5e317a8972926d4be66d777406a7','state IN(''in_progress'',''paused'') AND fulfillment_mode=''mobile'' AND first_work_at IS NOT NULL','state IN(''in_progress'',''paused'') AND fulfillment_mode IN(''mobile'',''dropoff'') AND first_work_at IS NOT NULL'),
  ('crest_commands.read_unfulfilled_cancellation_context(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid)','crest_booking_owner','v','71f1f21cf227607c36c27c402bbf715836c3668b37a76ccfc001a9f1af14fece','j.fulfillment_mode=''mobile''','j.fulfillment_mode IN(''mobile'',''dropoff'')'),
  ('crest_private.stamp_booking_row()','crest_booking_integrity_owner','v','0f21a0a7c4696194dc353b162873e26b0af6efd2880055c404a73c195251926c','OLD.state NOT IN(''in_progress'',''paused'') OR OLD.fulfillment_mode<>''mobile'' OR OLD.first_work_at IS NULL','OLD.state NOT IN(''in_progress'',''paused'') OR OLD.fulfillment_mode NOT IN(''mobile'',''dropoff'') OR OLD.first_work_at IS NULL'),
  ('crest_private.unfulfilled_job_result(uuid,uuid,uuid)','crest_booking_integrity_owner','s','6f302d90e567be829cc0fbcf7f98ce39adbcb4a7079f69fff1b8aa3a513ccd97','before_job->>''fulfillment_mode''<>''mobile'' OR after_job->>''fulfillment_mode''<>''mobile''','before_job->>''fulfillment_mode'' NOT IN(''mobile'',''dropoff'') OR after_job->>''fulfillment_mode'' IS DISTINCT FROM before_job->>''fulfillment_mode''')
 ) expected(signature,owner_name,volatility,body_hash,marker,replacement) LOOP
  routine:=to_regprocedure(entry.signature);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=routine AND p.proowner=entry.owner_name::regrole AND p.prosecdef AND NOT p.proleakproof
    AND p.provolatile::text=entry.volatility AND l.lanname='plpgsql'
    AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=entry.body_hash
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_CANCELLATION_SOURCE_REVIEW_REQUIRED';END IF;
  SELECT pg_get_functiondef(p.oid),p.proacl INTO definition,old_acl FROM pg_proc p WHERE p.oid=routine;
  IF (length(definition)-length(replace(definition,entry.marker,'')))/length(entry.marker)<>1
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_CANCELLATION_SOURCE_REVIEW_REQUIRED';END IF;
  EXECUTE replace(definition,entry.marker,entry.replacement);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=routine AND p.proowner=entry.owner_name::regrole
   AND p.prosecdef AND p.provolatile::text=entry.volatility AND p.proacl IS NOT DISTINCT FROM old_acl
   AND pg_get_functiondef(p.oid)=replace(definition,entry.marker,entry.replacement))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_CANCELLATION_SOURCE_REVIEW_REQUIRED';END IF;
 END LOOP;
END $review$;
