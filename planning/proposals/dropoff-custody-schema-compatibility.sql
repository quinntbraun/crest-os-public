-- Held custody compatibility over registered schema66. Preserve the exact
-- routine bodies, ownership and permissions while admitting only the reviewed
-- physical columns. The accepted schema66 fingerprint remains immutable.
DO $custody_schema$
DECLARE
 previous_fingerprint constant text:='a7160694f52e09208525077e7d0bc0a2022f7258c0e30c207cbcf4a31294faab';
 current_fingerprint constant text:='afcc9a7a4ad42648c2f29067aaa86fdb755b59d66b11256c6e1f162d96b2901b';
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
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_SCHEMA_REVIEW_REQUIRED',DETAIL='Physical schema or routine inventory differs';END IF;

 FOR expected IN SELECT * FROM (VALUES
  ('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'4fee367302d8a1b12bd4bf3078bccdbe0a8e4cfebfa19acc4973050087fe53fb'),
  ('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'afd5cac09841dc5dca69b54889389b03dca41a24c6774f4af273d5680edbfaa5'),
  ('crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'423bccc63f483bf9a6ce576bacadf42551120505033ea920ccd21e0b81df4185'),
  ('crest_commands.field_source_context(uuid)','crest_booking_integrity_owner',true,'bb0865ed5d13213e2c0368e9cb7b6dd9f7ef8a8aa1968d9ed7c446cb931b01be'),
  ('crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'7e4fdf7bf202b11be2a597ae91465aa3fe9affde7e927ebdf81620db21598c25'),
  ('crest_commands.quote_amendment_accepted_source_context(uuid)','crest_quote_owner',true,'7bc2d47487f4f9ecb9b2176abe89ad3fc46826e57a072544eb33411db51076ac'),
  ('crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)','crest_booking_owner',true,'a46cb4e80427b2a6d5edc0b06b5aa0d339fb7e295bfd6cd0fc7038035b8efb63'),
  ('crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,uuid,jsonb)','crest_booking_owner',true,'bdcea9c8405831a9fdbfd288171b9b1cfa637b21d46c1cc9512629bc7982bd7f'),
  ('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)','crest_quote_owner',false,'13db83c7d3cd0298e60569d3a6c197a52cdaa82ee9b5a1cbe9d028824232f3d0')
 ) AS entries(signature,owner_name,security_definer,definition_sha256) LOOP
  routine:=to_regprocedure(expected.signature);
  SELECT r.rolname,p.prosecdef,p.proacl,pg_get_functiondef(p.oid) AS definition INTO installed
  FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=routine;
  IF NOT FOUND OR installed.rolname IS DISTINCT FROM expected.owner_name
   OR installed.prosecdef IS DISTINCT FROM expected.security_definer
   OR encode(sha256(convert_to(installed.definition,'UTF8')),'hex') IS DISTINCT FROM expected.definition_sha256
   OR (length(installed.definition)-length(replace(installed.definition,previous_fingerprint,'')))<>length(previous_fingerprint)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_SCHEMA_REVIEW_REQUIRED',DETAIL='Routine predecessor differs: '||expected.signature;END IF;
  revised:=replace(installed.definition,previous_fingerprint,current_fingerprint);
  EXECUTE revised;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=routine
   AND r.rolname=installed.rolname AND p.prosecdef=installed.prosecdef
   AND p.proacl IS NOT DISTINCT FROM installed.proacl AND pg_get_functiondef(p.oid)=revised)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_SCHEMA_REVIEW_REQUIRED',DETAIL='Routine result differs: '||expected.signature;END IF;
 END LOOP;
END $custody_schema$;
