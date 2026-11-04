-- Unregistered P05/BR05/BR06 storage construction over registered51.
-- No command, browser route, approval, acceptance or finance activation.
-- Older migration bytes/receipts stay immutable. Initial quote projections keep
-- their exact historical shape; an amendment adds an explicit parent binding.
DO $review$
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>51
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='crest.quote_revisions'::regclass AND attname='parent_agreement_id' AND NOT attisdropped)
  OR to_regprocedure('crest_private.agreement_successor_valid(crest.agreements,crest.agreements)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_revision_projection(crest.quote_revisions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='593a98db39aed6bccaab60b0b8f373b555e6172966fd76d922c72301940201ae')
  OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='crest.quote_revisions'::regclass AND conname='quote_revisions_kind_check') IS DISTINCT FROM 'CHECK ((kind = ''initial''::text))'
  OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='crest.agreements'::regclass AND conname='agreements_version_no_check') IS DISTINCT FROM 'CHECK ((version_no = 1))'
  OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='crest.agreements'::regclass AND conname='agreements_parent_agreement_id_check') IS DISTINCT FROM 'CHECK ((parent_agreement_id IS NULL))'
  OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='crest.agreements'::regclass AND conname='agreements_check') IS DISTINCT FROM 'CHECK ((signed_delta_cents = total_cents))'
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN('crest.quote_revisions'::regclass,'crest.agreements'::regclass) AND (relowner<>'crest_schema_owner'::regrole OR NOT relrowsecurity OR NOT relforcerowsecurity))
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_integrity_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_STORAGE_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.quote_revisions ADD COLUMN parent_agreement_id uuid;
ALTER TABLE crest.quote_revisions DROP CONSTRAINT quote_revisions_kind_check;
ALTER TABLE crest.quote_revisions ADD CONSTRAINT quote_revisions_kind_check CHECK(kind IN('initial','amendment'));
ALTER TABLE crest.quote_revisions ADD CONSTRAINT quote_amendment_parent_shape CHECK(kind='initial' AND parent_agreement_id IS NULL OR kind='amendment' AND parent_agreement_id IS NOT NULL);
ALTER TABLE crest.quote_revisions ADD CONSTRAINT quote_amendment_parent_same_family FOREIGN KEY(business_id,parent_agreement_id,family_id) REFERENCES crest.agreements(business_id,id,family_id) ON DELETE RESTRICT;
-- A new Draft can replace a sent proposal only through the existing deliberate
-- share/withdraw path. Earlier Sent/Accepted/Superseded rows remain historical.
CREATE UNIQUE INDEX quote_one_open_amendment_draft ON crest.quote_revisions(business_id,family_id) WHERE kind='amendment' AND state IN('Draft','Ready for Review');

CREATE OR REPLACE FUNCTION crest_private.quote_revision_projection(v crest.quote_revisions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT (CASE WHEN (v).kind='initial' THEN to_jsonb(v)-'parent_agreement_id' ELSE to_jsonb(v) END)||jsonb_build_object('sequence',(v).sequence::text,'version',(v).version::text,'content_version',(v).content_version::text,'total_cents',(v).total_cents::text,'expiry_at',CASE WHEN (v).expiry_at IS NULL THEN NULL ELSE to_char((v).expiry_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;

ALTER TABLE crest.agreements DROP CONSTRAINT agreements_version_no_check;
ALTER TABLE crest.agreements DROP CONSTRAINT agreements_parent_agreement_id_check;
ALTER TABLE crest.agreements DROP CONSTRAINT agreements_check;
ALTER TABLE crest.agreements ADD CONSTRAINT agreements_version_no_check CHECK(version_no>0);
ALTER TABLE crest.agreements ADD CONSTRAINT agreements_parent_agreement_id_check CHECK(version_no=1 AND parent_agreement_id IS NULL OR version_no>1 AND parent_agreement_id IS NOT NULL AND parent_agreement_id<>id);
ALTER TABLE crest.agreements ADD CONSTRAINT agreements_initial_delta CHECK(version_no<>1 OR signed_delta_cents=total_cents);
ALTER TABLE crest.agreements ADD CONSTRAINT agreement_parent_same_family_customer FOREIGN KEY(business_id,parent_agreement_id,family_id,customer_id) REFERENCES crest.agreements(business_id,id,family_id,customer_id) ON DELETE RESTRICT;
ALTER TABLE crest.agreements ADD CONSTRAINT agreement_one_successor UNIQUE(business_id,parent_agreement_id);

-- Arithmetic/ancestry only. Current-parent authority, approval, acceptance,
-- completed/billed/credited/refunded limits and exact allocation revisions must
-- also be proved atomically by the future restricted acceptance command.
CREATE FUNCTION crest_private.agreement_successor_valid(v crest.agreements,parent crest.agreements) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce((v).id IS NOT NULL AND (v).business_id IS NOT NULL AND (v).family_id IS NOT NULL AND (v).customer_id IS NOT NULL AND (v).total_cents>=0 AND
  (CASE WHEN (v).parent_agreement_id IS NULL THEN (parent).id IS NULL AND (v).version_no=1 AND (v).signed_delta_cents=(v).total_cents
   ELSE (parent).id IS NOT NULL AND (v).id<>(parent).id AND (v).parent_agreement_id=(parent).id AND (v).business_id=(parent).business_id AND (v).family_id=(parent).family_id AND (v).customer_id=(parent).customer_id AND (parent).total_cents>=0 AND (parent).version_no>0 AND (v).version_no::numeric=(parent).version_no::numeric+1 AND (v).signed_delta_cents=(v).total_cents-(parent).total_cents END),false)
$valid$;
REVOKE ALL ON FUNCTION crest_private.agreement_successor_valid(crest.agreements,crest.agreements) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.agreement_successor_valid(crest.agreements,crest.agreements) TO crest_quote_integrity_owner;
GRANT SELECT ON crest.agreements TO crest_quote_integrity_owner;
CREATE POLICY amendment_integrity_parent_read ON crest.agreements FOR SELECT TO crest_quote_integrity_owner USING(true);
GRANT CREATE ON SCHEMA crest_private TO crest_quote_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE FUNCTION crest_private.check_agreement_successor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE parent crest.agreements;
BEGIN
 IF NEW.parent_agreement_id IS NOT NULL THEN SELECT * INTO parent FROM crest.agreements WHERE business_id=NEW.business_id AND id=NEW.parent_agreement_id AND family_id=NEW.family_id AND customer_id=NEW.customer_id;END IF;
 IF NOT crest_private.agreement_successor_valid(NEW,parent) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AGREEMENT_SUCCESSOR_REVIEW_REQUIRED';END IF;RETURN NULL;
END $check$;
CREATE FUNCTION crest_private.retain_quote_amendment_parent() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $retain$
BEGIN
 IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.parent_agreement_id IS DISTINCT FROM OLD.parent_agreement_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_PARENT_RETAINED';END IF;RETURN NEW;
END $retain$;
REVOKE ALL ON FUNCTION crest_private.check_agreement_successor() FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_private.retain_quote_amendment_parent() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_agreement_successor(),crest_private.retain_quote_amendment_parent() TO crest_schema_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER agreement_successor_integrity AFTER INSERT OR UPDATE ON crest.agreements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_agreement_successor();
CREATE TRIGGER quote_amendment_parent_retained BEFORE UPDATE ON crest.quote_revisions FOR EACH ROW EXECUTE FUNCTION crest_private.retain_quote_amendment_parent();
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner;
RESET ROLE;
