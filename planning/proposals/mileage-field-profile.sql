-- Unregistered joint field/mileage construction. The fixed write profile is
-- measured from fresh reviewed sources, never derived from the receiving DB.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.mileage_result(uuid,uuid,uuid)') IS NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)','crest_quote_owner',false,'b23cc705afeb9ffc71c0be57c9786343d1be1b0b24f313ba6b7f550b946ad679'),
   ('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'5b60aeda274eb5863718dba61e3a062298641c256784d407db36255d8d7d43a8'),
   ('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'ac9fceaf4c3ff38f6e921705dfc516646e856ee1f031a586e2866213b951a906')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner
   WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_quote_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_quote_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_quote_owner'::regrole))
  OR EXISTS(SELECT 1 FROM(VALUES('mileage_evidence'),('leg_job_allocations')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass('crest.'||e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MILEAGE_PROFILE_REVIEW_REQUIRED';END IF;
END $review$;
DO $extend$ DECLARE signature regprocedure;definition text;updated text;BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)'::regprocedure,
  'crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure,
  'crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure
 ] LOOP
  definition:=pg_get_functiondef(signature);
  updated:=replace(definition,'7d59758a46a631d2ddb9db8df7825aeb77745ba121655b85b4acb87b2748d56b','6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3');
  IF updated=definition THEN RAISE EXCEPTION 'CREST_MILEAGE_PROFILE_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 END LOOP;
END $extend$;
-- Unknown future fields/ledgers still refuse. This does not open the separate
-- source/export/recovery profiles or authorize financial consumption/posting.
