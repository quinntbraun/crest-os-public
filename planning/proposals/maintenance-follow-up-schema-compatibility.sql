-- Held schema66 compatibility. Advance the reviewed table/column identity
-- across the exact registered65 scheduling and source routines.
DO $maintenance_schema$
DECLARE
 previous_fingerprint constant text:='6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3';
 current_fingerprint constant text:='a7160694f52e09208525077e7d0bc0a2022f7258c0e30c207cbcf4a31294faab';
 expected record; routine oid; installed record; revised text;
BEGIN
 IF (SELECT encode(sha256(convert_to(string_agg(
   n.nspname||'.'||c.relname||'.'||a.attname,chr(10) ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"
  ),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid
  JOIN pg_attribute a ON a.attrelid=c.oid
  WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM current_fingerprint
  OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('crest_commands','crest_private') AND p.prokind IN ('f','p')
   AND position(previous_fingerprint in pg_get_functiondef(p.oid))>0)<>9
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MAINTENANCE_SCHEMA_REVIEW_REQUIRED',DETAIL='Physical schema or routine inventory differs';END IF;

 FOR expected IN SELECT * FROM (VALUES
  ('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'c81aafac7dbd8e680d93212d516e556ca7496a499c997ccd384ed12259211dad'),
  ('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'85e1a1e67b92f4f90597af0d049f157e732dbcaa15cf0ebf7975263066b27530'),
  ('crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'088f47c8b33bcc664ef2af0661d9b0589dff7b4ba582fe4abfea8f04c1fc59e0'),
  ('crest_commands.field_source_context(uuid)','crest_booking_integrity_owner',true,'6fc110b1bbab0fe1b2ff1038ba3b7fed73ba96d01699d74e0ea746e31a4935f7'),
  ('crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'0484e5ec71112a38de64c656fb222a8c146a302db653f49a9080bf2383ebeaa8'),
  ('crest_commands.quote_amendment_accepted_source_context(uuid)','crest_quote_owner',true,'e4ace7bf41dbe5a6a447f66a322a41b9ea1beb647b31dc4d008454371010ff59'),
  ('crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)','crest_booking_owner',true,'795ea0c718638fbe4521771825e2b3b0352df108571b9fc5176403c1eee63e85'),
  ('crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,uuid,jsonb)','crest_booking_owner',true,'1affd9e5adad73b9767a687848bf0dc8b11d539d22569a370970e44953a636c0'),
  ('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)','crest_quote_owner',false,'32f55c779b41c5211542610198f40710120a2bd2b678629510b1d4b253a014db')
 ) AS entries(signature,owner_name,security_definer,definition_sha256) LOOP
  routine:=to_regprocedure(expected.signature);
  SELECT r.rolname,p.prosecdef,p.proacl,pg_get_functiondef(p.oid) AS definition INTO installed
  FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=routine;
  IF NOT FOUND OR installed.rolname IS DISTINCT FROM expected.owner_name
   OR installed.prosecdef IS DISTINCT FROM expected.security_definer
   OR encode(sha256(convert_to(installed.definition,'UTF8')),'hex') IS DISTINCT FROM expected.definition_sha256
   OR (length(installed.definition)-length(replace(installed.definition,previous_fingerprint,'')))<>length(previous_fingerprint)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MAINTENANCE_SCHEMA_REVIEW_REQUIRED',DETAIL='Routine predecessor differs: '||expected.signature;END IF;
  revised:=replace(installed.definition,previous_fingerprint,current_fingerprint);
  EXECUTE revised;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=routine
   AND r.rolname=installed.rolname AND p.prosecdef=installed.prosecdef
   AND p.proacl IS NOT DISTINCT FROM installed.proacl AND pg_get_functiondef(p.oid)=revised)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MAINTENANCE_SCHEMA_REVIEW_REQUIRED',DETAIL='Routine result differs: '||expected.signature;END IF;
 END LOOP;
END $maintenance_schema$;
