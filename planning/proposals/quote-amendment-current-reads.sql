-- UNREGISTERED current and historical saved reads after accepted amendments.
-- Legacy1 packets remain unchanged for unbound initial work. Version2 carries
-- explicit current authorization and immutable original/encounter provenance.
DO $review$ BEGIN
 IF(SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.read_quote_amendment_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,bigint,integer)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='2aa729d15c9f195980effe0a42f8fe6730de10ab9e6aa93f813695b0d6df6a36')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.read_booking_agreement(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='f3bf5baa07146e53bd39407c6f28a3d106273138c023d2121177b237f0889aff')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.read_confirmed_job_resources(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='bde4a0bc4d089af1b902127fecaef8825f98332ec797cd6805bd3a69da300e65')
 OR(SELECT count(*) FROM pg_roles WHERE rolname IN('crest_quote_owner','crest_booking_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_quote_owner','crest_booking_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_CURRENT_READ_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner,crest_booking_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_quote_amendment_workspace(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, requested_family uuid, requested_revision uuid, after_version bigint, page_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;f crest.quote_families;r crest.quote_revisions;g crest.agreements;parent_revision crest.quote_revisions;c crest.quote_family_commercial_state;p crest.quote_approvals;s crest.quote_sends;send_event uuid;accepted_row crest.quote_acceptances;accepted_original jsonb;result jsonb;
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
 IF r.state='Accepted' THEN
  SELECT * INTO accepted_row FROM crest.quote_acceptances WHERE business_id=requested_business AND family_id=requested_family AND revision_id=requested_revision AND kind='amendment';
  IF accepted_row.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_READ_RESULT_REVIEW_REQUIRED';END IF;
  accepted_original:=crest_private.amendment_accept_result(requested_business,accepted_row.created_by,accepted_row.operation_id);
  IF accepted_original->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_READ_RESULT_REVIEW_REQUIRED';END IF;
  result:=result||jsonb_build_object('schemaVersion',2,'acceptance',jsonb_build_object('request',accepted_row.request,'original',accepted_original,'recordedAt',to_char(accepted_row.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 END IF;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_AMENDMENT_READ_PAGE_LIMIT';END IF;RETURN result;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_booking_agreement(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, requested_family uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_family IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT CASE WHEN g.version_no>1 OR EXISTS(SELECT 1 FROM crest.allocation_plan_versions bound JOIN crest.scope_allocations root ON root.business_id=bound.business_id AND root.id=bound.source_allocation_id JOIN crest.scope_entitlements ent ON ent.business_id=root.business_id AND ent.id=root.entitlement_id WHERE bound.business_id=f.business_id AND ent.agreement_family_id=f.id AND bound.entitlement_version_id IS NOT NULL) THEN jsonb_build_object('schemaVersion',2,'businessId',requested_business,'familyId',f.id,'familyVersion',f.version::text,'agreementId',g.id,'agreementVersion',g.version_no::text,'totalCents',g.total_cents::text,'sourceCount',(SELECT count(*) FROM crest.scope_entitlements counted WHERE counted.business_id=f.business_id AND counted.agreement_family_id=f.id),'customer',crest_private.customer_projection(c),
 'vehicles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',vehicle.id,'label',vehicle.label,'version',vehicle.version::text,'archivedAt',to_char(vehicle.archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY vehicle.id) FROM crest.vehicles vehicle WHERE vehicle.business_id=requested_business AND EXISTS(SELECT 1 FROM crest.scope_entitlements ent WHERE ent.business_id=f.business_id AND ent.agreement_family_id=f.id AND ent.vehicle_id=vehicle.id)),'[]'::jsonb),
 'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',s.id,'entitlementId',ent.id,'entitlementVersionId',CASE WHEN coalesce(plan.entitlement_version_id,s.entitlement_version_id)=ev.id THEN ev.id ELSE NULL END,'agreementId',ev.agreement_id,'sourcePartitionId',s.stable_partition_id,'vehicleId',ent.vehicle_id,'jobWide',ent.job_wide,
  'grossInclusiveCents',CASE WHEN plan.authorization_state='withdrawn' THEN '0' ELSE ev.scope_snapshot->>'grossCents' END,'discountInclusiveCents',CASE WHEN plan.authorization_state='withdrawn' THEN '0' ELSE((ev.scope_snapshot->>'lineDiscountCents')::bigint+(ev.scope_snapshot->>'allocatedDiscountCents')::bigint)::text END,'amountCents',ev.authorized_cents::text,'scopeDescription',ev.scope_snapshot->>'description',
  'authorizationState',CASE WHEN plan.entitlement_version_id IS NULL THEN 'active' ELSE plan.authorization_state END,'original',jsonb_build_object('agreementId',s.agreement_id,'entitlementVersionId',s.entitlement_version_id,'grossInclusiveCents',s.gross_inclusive_cents::text,'discountInclusiveCents',s.discount_inclusive_cents::text,'amountCents',s.amount_cents::text,'scopeDescription',s.scope_description),
  'planId',plan.id,'planSequence',coalesce(plan.sequence,0)::text,'parts',coalesce((SELECT jsonb_agg(jsonb_build_object('partitionId',current_part.stable_partition_id,'jobId',current_part.job_id,'state',current_part.allocation_state,'grossInclusiveCents',current_part.gross_inclusive_cents::text,'discountInclusiveCents',current_part.discount_inclusive_cents::text,'amountCents',current_part.amount_cents::text,'scopeDescription',current_part.scope_description) ORDER BY current_part.stable_partition_id) FROM crest.current_scope_allocation_parts current_part WHERE current_part.business_id=s.business_id AND current_part.source_allocation_id=s.id),'[]'::jsonb)) ORDER BY s.id)
 FROM crest.scope_entitlements ent LEFT JOIN crest.scope_allocations s ON s.business_id=ent.business_id AND s.entitlement_id=ent.id
 LEFT JOIN crest.entitlement_versions ev ON ev.business_id=ent.business_id AND ev.family_id=ent.agreement_family_id AND ev.entitlement_id=ent.id AND ev.agreement_id=g.id
 LEFT JOIN LATERAL(SELECT selected.* FROM crest.allocation_plan_versions selected WHERE selected.business_id=s.business_id AND selected.source_allocation_id=s.id ORDER BY selected.sequence DESC LIMIT 1) plan ON true
 WHERE ent.business_id=f.business_id AND ent.agreement_family_id=f.id),'[]'::jsonb)) ELSE jsonb_build_object('schemaVersion',1,'businessId',requested_business,'familyId',f.id,'familyVersion',f.version::text,'agreementId',g.id,'agreementVersion',g.version_no::text,'customer',crest_private.customer_projection(c),
 'vehicles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'label',v.label,'version',v.version::text,'archivedAt',to_char(v.archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY v.id) FROM crest.vehicles v WHERE v.business_id=requested_business AND EXISTS(SELECT 1 FROM crest.scope_entitlements e JOIN crest.scope_allocations s ON s.business_id=e.business_id AND s.entitlement_id=e.id WHERE e.business_id=requested_business AND s.agreement_id=g.id AND e.vehicle_id=v.id)),'[]'::jsonb),
 'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',s.id,'entitlementId',s.entitlement_id,'entitlementVersionId',s.entitlement_version_id,'agreementId',s.agreement_id,'sourcePartitionId',s.stable_partition_id,'vehicleId',e.vehicle_id,'jobWide',e.job_wide,'grossInclusiveCents',s.gross_inclusive_cents::text,'discountInclusiveCents',s.discount_inclusive_cents::text,'amountCents',s.amount_cents::text,'scopeDescription',s.scope_description,
 'planId',(SELECT p.id FROM crest.allocation_plan_versions p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id ORDER BY p.sequence DESC LIMIT 1),
 'planSequence',coalesce((SELECT p.sequence::text FROM crest.allocation_plan_versions p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id ORDER BY p.sequence DESC LIMIT 1),'0'),
 'parts',(SELECT jsonb_agg(jsonb_build_object('partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.stable_partition_id) FROM crest.current_scope_allocation_parts p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id)) ORDER BY s.id)
 FROM crest.scope_allocations s JOIN crest.scope_entitlements e ON e.business_id=s.business_id AND e.id=s.entitlement_id WHERE s.business_id=requested_business AND s.agreement_id=g.id),'[]'::jsonb)) END INTO result
 FROM crest.quote_families f JOIN crest.quote_family_commercial_state control ON control.business_id=f.business_id AND control.family_id=f.id
 JOIN crest.agreements g ON g.business_id=f.business_id AND g.id=control.current_agreement_id AND g.family_id=f.id JOIN crest.customers c ON c.business_id=g.business_id AND c.id=g.customer_id
 WHERE f.business_id=requested_business AND f.id=requested_family;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_CONTEXT_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_confirmed_job_resources(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, requested_job uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT CASE WHEN EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts current_part JOIN crest.allocation_plan_versions bound ON bound.business_id=current_part.business_id AND bound.id=current_part.plan_id WHERE current_part.business_id=j.business_id AND current_part.job_id=j.id AND bound.entitlement_version_id IS NOT NULL) OR EXISTS(SELECT 1 FROM crest.job_encounters encounter JOIN crest.quote_family_commercial_state current_family ON current_family.business_id=encounter.business_id AND current_family.family_id=encounter.family_id WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND current_family.current_agreement_id IS DISTINCT FROM encounter.agreement_id) THEN jsonb_build_object('schemaVersion',2,'businessId',requested_business,'jobId',j.id,'head',crest_private.booking_job_display_snapshot(j),
 'vehicles',(SELECT jsonb_agg(crest_private.job_vehicles_projection(v) ORDER BY v.id) FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id),
 'encounters',(SELECT jsonb_agg(crest_private.job_encounters_projection(e) ORDER BY e.id) FROM crest.job_encounters e WHERE e.business_id=j.business_id AND e.job_id=j.id),
 'scopeParts',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',p.source_allocation_id,'entitlementId',p.entitlement_id,'entitlementVersionId',p.entitlement_version_id,'agreementId',CASE WHEN p.agreement_id=control.current_agreement_id THEN p.agreement_id ELSE NULL END,'familyId',ent.agreement_family_id,
 'encounterAgreementId',(SELECT encounter.agreement_id FROM crest.job_encounters encounter WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND encounter.family_id=ent.agreement_family_id),
 'planId',p.plan_id,'planSequence',p.plan_sequence::text,'partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.source_allocation_id,p.stable_partition_id)
 FROM crest.current_scope_allocation_parts p LEFT JOIN crest.scope_entitlements ent ON ent.business_id=p.business_id AND ent.id=p.entitlement_id LEFT JOIN crest.quote_family_commercial_state control ON control.business_id=ent.business_id AND control.family_id=ent.agreement_family_id WHERE p.business_id=j.business_id AND p.job_id=j.id),'[]'::jsonb)) ELSE jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',j.id,'head',crest_private.booking_job_display_snapshot(j),
 'vehicles',(SELECT jsonb_agg(crest_private.job_vehicles_projection(v) ORDER BY v.id) FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id),
 'encounters',(SELECT jsonb_agg(crest_private.job_encounters_projection(e) ORDER BY e.id) FROM crest.job_encounters e WHERE e.business_id=j.business_id AND e.job_id=j.id),
 'scopeParts',(SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',p.source_allocation_id,'entitlementId',p.entitlement_id,'entitlementVersionId',p.entitlement_version_id,'agreementId',p.agreement_id,'planId',p.plan_id,'planSequence',p.plan_sequence::text,'partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.source_allocation_id,p.stable_partition_id) FROM crest.current_scope_allocation_parts p WHERE p.business_id=j.business_id AND p.job_id=j.id)) END INTO result FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_CONTEXT_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner,crest_booking_owner;
RESET ROLE;
