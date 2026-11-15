-- Held field-inclusive parent source profile. Frozen registered53 bytes stay
-- unchanged. Only the two reviewed accepted-source schema fingerprints
-- advances; all read-only snapshot, scope, count and export-role checks remain.
DO $review$
BEGIN
 IF to_regprocedure('crest_commands.field_source_context(uuid)') IS NULL
  OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>53
  OR EXISTS(SELECT 1 FROM (VALUES
   ('crest_commands.booking_source_snapshot_context(uuid)','crest_booking_owner','6cec477914b0a3ed7b97ba5349dfbe14021e9e0fbc4339d24345ee88ad4cb072'),
   ('crest_commands.field_source_context(uuid)','crest_booking_integrity_owner','6fc110b1bbab0fe1b2ff1038ba3b7fed73ba96d01699d74e0ea746e31a4935f7'),
   ('crest_commands.quote_amendment_accepted_source_context(uuid)','crest_quote_owner','3affd285717ad8920f00816c3063ad468382af1083e445164e77c4dc1344a641'),
   ('crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)','crest_booking_owner','98327c579ee89fa08e35aeeefd854e72d29edb03030249b65325627e517bdf45'),
   ('crest_commands.quote_commercial_snapshot_context(uuid)','crest_quote_owner','9da5f41d56e7afa4421a4e8fbf6e5e7879e5a6193d3772e7b82dbae270e9bce7'),
   ('crest_commands.quote_review_snapshot_context(uuid)','crest_quote_owner','ed01a02fa6ce128b370ae288ba5b43c99a86a45856ca2129ae85b78e815706d3')
  ) e(signature,owner,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
   LEFT JOIN pg_roles r ON r.oid=p.proowner
   WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR NOT p.prosecdef OR p.proleakproof
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
    OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_booking_owner','crest_booking_integrity_owner')
   AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole)
   OR member IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a
   WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN('crest','crest_private') AND c.relkind IN('r','p') AND (c.relowner<>'crest_schema_owner'::regrole OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND (has_schema_privilege('crest_quote_owner',oid,'CREATE') OR has_schema_privilege('crest_booking_owner',oid,'CREATE')))
  OR (SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY (n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex')
   FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped)
    IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_PARENT_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner,crest_booking_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
DO $replace$
DECLARE original text;updated text;
BEGIN
 original:=pg_get_functiondef('crest_commands.quote_amendment_accepted_source_context(uuid)'::regprocedure);
 IF (length(original)-length(replace(original,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','')))/64<>1
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_PARENT_SOURCE_REVIEW_REQUIRED';END IF;
 updated:=replace(original,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3');
 EXECUTE updated;
END $replace$;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
DO $replace$
DECLARE original text;updated text;
BEGIN
 original:=pg_get_functiondef('crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)'::regprocedure);
 IF (length(original)-length(replace(original,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','')))/64<>1
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_PARENT_SOURCE_REVIEW_REQUIRED';END IF;
 updated:=replace(original,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3');
 EXECUTE updated;
END $replace$;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner,crest_booking_owner;
RESET ROLE;
