-- UNREGISTERED private workspace reader over registered51 + reviewed amendment
-- proposals. Preserves legacy initial-only reader bytes and grants. No route,
-- write, external transmission, customer acceptance or schema adoption.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>51 OR to_regprocedure('crest_private.amendment_send_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_commands.read_quote_amendment_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,bigint,integer)') IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_READ_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_quote_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_quote_owner'::regrole OR member='crest_quote_owner'::regrole) OR EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclobjtype='f' AND d.defaclrole='crest_quote_owner'::regrole AND a.grantee<>d.defaclrole) OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_quote_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_quote_owner'::regrole))) a WHERE a.grantee<>'crest_quote_owner'::regrole) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_READ_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_commands.read_quote_amendment_workspace(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_family uuid,requested_revision uuid,after_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;f crest.quote_families;r crest.quote_revisions;g crest.agreements;parent_revision crest.quote_revisions;c crest.quote_family_commercial_state;p crest.quote_approvals;s crest.quote_sends;send_event uuid;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_family IS NULL OR requested_revision IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_READ_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 -- Every mutation takes this family lock first. The shared lock keeps the
 -- multi-query packet coherent; it changes no business/operation/audit source.
 SELECT * INTO f FROM crest.quote_families WHERE business_id=requested_business AND id=requested_family FOR SHARE;
 SELECT * INTO r FROM crest.quote_revisions WHERE business_id=requested_business AND family_id=requested_family AND id=requested_revision AND kind='amendment';
 IF f.id IS NULL OR r.id IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT * INTO g FROM crest.agreements WHERE business_id=requested_business AND family_id=requested_family AND id=r.parent_agreement_id;
 SELECT q.* INTO parent_revision FROM crest.quote_acceptances a JOIN crest.quote_revisions q ON q.business_id=a.business_id AND q.family_id=a.family_id AND q.id=a.revision_id WHERE a.business_id=requested_business AND a.family_id=requested_family AND a.id=g.acceptance_id AND a.customer_id=g.customer_id;
 SELECT * INTO c FROM crest.quote_family_commercial_state WHERE business_id=requested_business AND family_id=requested_family;
 IF g.id IS NULL OR parent_revision.id IS NULL OR parent_revision.state<>'Accepted' OR c.id IS NULL OR c.initial_acceptance_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_READ_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO p FROM crest.quote_approvals WHERE business_id=requested_business AND family_id=requested_family AND revision_id=requested_revision AND approved_content_version=r.content_version AND approved_content_hash=r.content_hash;
 -- Revision version orders actual send events, including a backwards wall
 -- clock. A later supersession is not mistaken for a delivery of this revision.
 SELECT sent.* INTO s FROM crest.quote_sends sent JOIN crest_private.audit_events a ON a.business_id=sent.business_id AND a.operation_id=sent.operation_id AND a.entity_kind='quote_revisions' AND a.entity_id=sent.revision_id AND a.action='send' AND a.delta->'after'->>'state'='Sent' WHERE sent.business_id=requested_business AND sent.family_id=requested_family AND sent.revision_id=requested_revision ORDER BY a.entity_version DESC LIMIT 1;
 SELECT id INTO send_event FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='quote_sends' AND entity_id=s.id AND entity_version=1 AND delta->'after'=crest_private.quote_sends_projection(s);
 IF s.id IS NOT NULL AND send_event IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_READ_RESULT_REVIEW_REQUIRED';END IF;
 WITH events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='quote_revisions' AND entity_id=requested_revision AND entity_version>after_version AND entity_version<=r.version ORDER BY entity_version LIMIT page_limit+1),page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'family',crest_private.quote_family_projection(f),'revision',crest_private.quote_revision_projection(r),'parent',jsonb_build_object('agreementId',g.id,'acceptanceId',g.acceptance_id,'versionNo',g.version_no::text,'customerId',g.customer_id,'sourceLeadId',f.lead_id,'revision',crest_private.quote_revision_projection(parent_revision)),
  'control',jsonb_build_object('version',c.version::text,'activeOfferId',c.active_offer_id,'initialAcceptanceId',c.initial_acceptance_id,'currentAgreementId',c.current_agreement_id),
  'items',coalesce((SELECT jsonb_agg(crest_private.quote_item_projection(i) ORDER BY position) FROM crest.quote_items i WHERE i.business_id=requested_business AND i.revision_id=requested_revision AND i.active),'[]'::jsonb),
  'approval',CASE WHEN p.id IS NULL THEN NULL ELSE crest_private.quote_approval_packet(p) END,
  'latestSend',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'approvalId',s.approval_id,'channel',s.channel,'recipientSnapshot',s.recipient_snapshot,'confirmedAt',to_char(s.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'evidenceNote',s.evidence_note,'presentationHash',s.presentation_hash,'operationId',s.operation_id,'auditEventId',send_event,'replacesRevisionId',s.replaces_revision_id) END,
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('eventId',id,'revision',entity_version::text,'action',action,'at',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'actorId',actor_id,'operationId',operation_id,'before',delta->'before','after',delta->'after') ORDER BY entity_version) FROM page),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM events)) INTO result;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_AMENDMENT_READ_PAGE_LIMIT';END IF;RETURN result;
END $read$;
REVOKE ALL ON FUNCTION crest_commands.read_quote_amendment_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_quote_amendment_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) TO crest_web;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner;
RESET ROLE;
