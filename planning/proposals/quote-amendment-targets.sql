-- UNREGISTERED accepted-quote selector for the amendment workspace. One SQL
-- statement observes family/current revision/current accepted parent together.
-- This is a read, never permission to create or share a later change. Existing
-- commands recheck exact parent/family versions and hashes before every write.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>51 OR to_regprocedure('crest_commands.read_quote_amendment_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,bigint,integer)') IS NULL OR to_regprocedure('crest_commands.read_quote_amendment_targets(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,text,uuid,integer)') IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_TARGET_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_quote_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_quote_owner'::regrole OR member='crest_quote_owner'::regrole) OR EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclobjtype='f' AND d.defaclrole='crest_quote_owner'::regrole AND a.grantee<>d.defaclrole) OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_quote_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_quote_owner'::regrole))) a WHERE a.grantee<>'crest_quote_owner'::regrole) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_TARGET_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_commands.read_quote_amendment_targets(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_family uuid,search_text text,after_family uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $targets$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF search_text IS NULL OR char_length(search_text)>200 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 OR (requested_family IS NOT NULL AND (search_text<>'' OR after_family IS NOT NULL OR page_limit<>1)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_TARGET_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 -- Restrict the selector to families with an actual current agreement. Left
 -- joins retain a malformed related source in the packet so strict consumers
 -- refuse it instead of silently omitting an accepted family's work.
 WITH matches AS MATERIALIZED(
  SELECT f.id,crest_private.quote_family_projection(f) AS family,crest_private.quote_revision_projection(r) AS revision,
   jsonb_build_object('agreementId',g.id,'acceptanceId',g.acceptance_id,'versionNo',g.version_no::text,'customerId',g.customer_id,'sourceLeadId',f.lead_id,'revision',crest_private.quote_revision_projection(p)) AS parent,
   jsonb_build_object('version',c.version::text,'activeOfferId',c.active_offer_id,'initialAcceptanceId',c.initial_acceptance_id,'currentAgreementId',c.current_agreement_id) AS control
  FROM crest.quote_families f JOIN crest.quote_family_commercial_state c ON c.business_id=f.business_id AND c.family_id=f.id AND c.current_agreement_id IS NOT NULL
  LEFT JOIN crest.quote_revisions r ON r.business_id=f.business_id AND r.family_id=f.id AND r.id=f.current_revision_id
  LEFT JOIN crest.agreements g ON g.business_id=f.business_id AND g.family_id=f.id AND g.id=c.current_agreement_id
  LEFT JOIN crest.quote_acceptances a ON a.business_id=g.business_id AND a.family_id=g.family_id AND a.id=g.acceptance_id AND a.customer_id=g.customer_id
  LEFT JOIN crest.quote_revisions p ON p.business_id=a.business_id AND p.family_id=a.family_id AND p.id=a.revision_id
  WHERE f.business_id=requested_business AND (requested_family IS NULL OR f.id=requested_family) AND (after_family IS NULL OR f.id>after_family)
   AND (search_text='' OR strpos(lower(p.customer_safe_snapshot->>'title'),lower(search_text))>0 OR strpos(lower(p.customer_safe_snapshot->'recipient'->>'displayName'),lower(search_text))>0 OR strpos(lower(r.customer_safe_snapshot->>'title'),lower(search_text))>0)
  ORDER BY f.id LIMIT page_limit+1
 ),page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'targets',coalesce((SELECT jsonb_agg(jsonb_build_object('family',family,'revision',revision,'parent',parent,'control',control) ORDER BY id) FROM page),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_AMENDMENT_TARGET_PAGE_LIMIT';END IF;RETURN result;
END $targets$;
REVOKE ALL ON FUNCTION crest_commands.read_quote_amendment_targets(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_quote_amendment_targets(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,uuid,integer) TO crest_web;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner;
RESET ROLE;
