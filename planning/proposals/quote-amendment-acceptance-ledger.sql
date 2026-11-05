-- UNREGISTERED BR05 acceptance-ledger construction over registered52.
-- One initial acceptance per family; later amendment acceptances remain distinct.
-- No new command, browser grant, owner migration or finance activation.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='crest.quote_acceptances'::regclass AND attname='kind' AND NOT attisdropped)
  OR to_regprocedure('crest_private.quote_acceptance_kind_valid(crest.quote_acceptances,crest.quote_revisions,crest_private.operations)') IS NOT NULL
  OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='crest.quote_acceptances'::regclass AND conname='quote_acceptances_business_id_family_id_key') IS DISTINCT FROM 'UNIQUE (business_id, family_id)'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_acceptances_projection(crest.quote_acceptances)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='0a4422a3f8846b366fc836d32d04eeb82104b1e9bae62857e358fda5007dc63d')
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.quote_acceptances'::regclass AND (relowner<>'crest_schema_owner'::regrole OR NOT relrowsecurity OR NOT relforcerowsecurity))
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_integrity_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPTANCE_LEDGER_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.quote_acceptances ADD COLUMN kind text NOT NULL DEFAULT 'initial' CHECK(kind IN('initial','amendment'));
ALTER TABLE crest.quote_acceptances DROP CONSTRAINT quote_acceptances_business_id_family_id_key;
CREATE UNIQUE INDEX quote_one_initial_acceptance ON crest.quote_acceptances(business_id,family_id) WHERE kind='initial';
-- Prior receipts and audit images must retain their original exact shape.
CREATE OR REPLACE FUNCTION crest_private.quote_acceptances_projection(v crest.quote_acceptances) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT (CASE WHEN (v).kind='initial' THEN to_jsonb(v)-'kind' ELSE to_jsonb(v) END)||jsonb_build_object('version',(v).version::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'confirmation_effective_at',to_char((v).confirmation_effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recorded_at',to_char((v).recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.quote_acceptance_kind_valid(a crest.quote_acceptances,r crest.quote_revisions,o crest_private.operations) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce((a).id IS NOT NULL AND (r).id IS NOT NULL AND (o).operation_id IS NOT NULL
  AND (a).business_id=(r).business_id AND (a).business_id=(o).business_id
  AND (a).family_id=(r).family_id AND (a).revision_id=(r).id
  AND (a).operation_id=(o).operation_id AND (a).created_by=(o).actor_id
  AND (a).content_hash=(r).content_hash AND (r).state='Accepted'
  AND (o).state='committed' AND (o).schema_version=1 AND (o).result->'schemaVersion'='1'::jsonb
  AND CASE WHEN (a).kind='initial' THEN (r).kind='initial' AND (r).parent_agreement_id IS NULL AND (o).command_type='quote.confirmation.accept'
   WHEN (a).kind='amendment' THEN (r).kind='amendment' AND (r).parent_agreement_id IS NOT NULL AND (a).conversion_id IS NULL AND (o).command_type='quote.amendment.accept'
   ELSE false END,false)
$valid$;
REVOKE ALL ON FUNCTION crest_private.quote_acceptance_kind_valid(crest.quote_acceptances,crest.quote_revisions,crest_private.operations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.quote_acceptance_kind_valid(crest.quote_acceptances,crest.quote_revisions,crest_private.operations) TO crest_quote_integrity_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE FUNCTION crest_private.check_quote_acceptance_kind() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE r crest.quote_revisions;o crest_private.operations;
BEGIN
 SELECT * INTO r FROM crest.quote_revisions WHERE business_id=NEW.business_id AND family_id=NEW.family_id AND id=NEW.revision_id;
 SELECT business_id,operation_id,actor_id,command_type,schema_version,state,result INTO o.business_id,o.operation_id,o.actor_id,o.command_type,o.schema_version,o.state,o.result FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by;
 IF NOT crest_private.quote_acceptance_kind_valid(NEW,r,o) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_ACCEPTANCE_KIND_REQUIRED';END IF;
 RETURN NULL;
END $check$;
REVOKE ALL ON FUNCTION crest_private.check_quote_acceptance_kind() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_quote_acceptance_kind() TO crest_schema_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER quote_acceptance_kind AFTER INSERT ON crest.quote_acceptances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_acceptance_kind();
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner;
RESET ROLE;
