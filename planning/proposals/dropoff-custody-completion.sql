-- Held schema66 extension after the Drop-Off custody and work overlays.
-- End the existing work interval and retain scope, review and finalization
-- evidence. Vehicle custody still changes only through its handoff command.
DO $review$
DECLARE entry record; function_id regprocedure; definition text;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('crest_private.check_completed_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner','1d27a4e7ba8d7a56485be8c2157447cd616def74c99eb405df0340b8cd4f03ee',
   $mode$j.fulfillment_mode<>'mobile'$mode$,$mode$j.fulfillment_mode NOT IN('mobile','dropoff')$mode$,1),
  ('crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner','5f120de35b3cc421cc441813a2fdb7005afec57a7ec45a47e3a846541dbcad1c',
   $mode$j.fulfillment_mode<>'mobile'$mode$,$mode$j.fulfillment_mode NOT IN('mobile','dropoff')$mode$,1),
  ('crest_commands.read_job_completion_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)','crest_booking_owner','81a7b0637eec01ae6bbdc4bd92293efe88a22fe1cff6287ea4b1d7d233773e60',
   $mode$j.fulfillment_mode='mobile'$mode$,$mode$j.fulfillment_mode IN('mobile','dropoff')$mode$,2)
 ) expected(signature,owner,body_hash,marker,replacement,occurrences) LOOP
  function_id:=to_regprocedure(entry.signature);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=function_id AND p.proowner=entry.owner::regrole AND p.prosecdef AND NOT p.proleakproof
    AND p.provolatile='v' AND l.lanname='plpgsql' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=entry.body_hash
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_COMPLETION_SOURCE_REVIEW_REQUIRED';END IF;
  definition:=pg_get_functiondef(function_id);
  IF (length(definition)-length(replace(definition,entry.marker,'')))/length(entry.marker)<>entry.occurrences
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_COMPLETION_SOURCE_REVIEW_REQUIRED';END IF;
  EXECUTE replace(definition,entry.marker,entry.replacement);
 END LOOP;
END $review$;
