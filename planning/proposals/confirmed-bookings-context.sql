-- Scoped construction reads for booking/field screens. Original commercial
-- packets remain historical; current assignments are a separate projection.
DO $review$ BEGIN
 IF to_regclass('crest.current_scope_allocation_parts') IS NULL OR to_regprocedure('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
 OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole) AND d.defaclobjtype='f' AND a.grantee NOT IN(d.defaclrole,0))
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.read_confirmed_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='9651fa42beb41bdd30a4cbfd7679ba04937bae426ea40f29e2a0c2507cba64a3')
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
 OR to_regprocedure('crest_private.booking_job_display_snapshot(crest.jobs)') IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_CONTEXT_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,timezone) ON crest.businesses TO crest_booking_owner;
CREATE POLICY booking_workspace_business_read ON crest.businesses FOR SELECT TO crest_booking_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
-- STABLE/INVOKER is intentional: all nested resources in a caller SELECT use
-- that statement's snapshot and the caller's already authorized tenant RLS.
CREATE FUNCTION crest_private.booking_job_display_snapshot(j crest.jobs) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $display$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',(j).business_id,'job',crest_private.jobs_projection(j),'appointment',crest_private.appointments_projection(a),
  'latestAppointment',(SELECT crest_private.appointments_projection(latest) FROM crest.appointments latest WHERE latest.business_id=(j).business_id AND latest.job_id=(j).id ORDER BY latest.sequence DESC LIMIT 1),
  'confirmationDraft',(SELECT e.evidence->'confirmationDraft' FROM crest.job_events e WHERE e.business_id=(j).business_id AND e.job_id=(j).id AND e.operation_id=(SELECT latest.operation_id FROM crest.appointments latest WHERE latest.business_id=(j).business_id AND latest.job_id=(j).id ORDER BY latest.sequence DESC LIMIT 1)),
  'vehicleCount',(SELECT count(*)::integer FROM crest.job_vehicles v WHERE v.business_id=(j).business_id AND v.job_id=(j).id),
  'encounterCount',(SELECT count(*)::integer FROM crest.job_encounters e WHERE e.business_id=(j).business_id AND e.job_id=(j).id),
  'allocationCount',(SELECT count(*)::integer FROM crest.current_scope_allocation_parts p WHERE p.business_id=(j).business_id AND p.job_id=(j).id))
 FROM crest.appointments a WHERE a.business_id=(j).business_id AND a.id=(j).current_appointment_id AND a.job_id=(j).id
$display$;
REVOKE ALL ON FUNCTION crest_private.booking_job_display_snapshot(crest.jobs) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.booking_job_display_snapshot(crest.jobs) TO crest_booking_owner;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_confirmed_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $detail$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_READ_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT crest_private.booking_job_display_snapshot(j) INTO result FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_READ_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $detail$;
CREATE FUNCTION crest_commands.read_booking_workspace(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $workspace$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operatorId',expected_actor,'timezone',b.timezone,'modeVersion',(SELECT crest_private.fulfillment_mode_projection(m) FROM crest.fulfillment_mode_versions m WHERE m.business_id=requested_business ORDER BY m.sequence DESC LIMIT 1)) INTO result FROM crest.businesses b WHERE b.id=requested_business;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN result;
END $workspace$;
CREATE FUNCTION crest_commands.read_booking_agreement(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_family uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $agreement$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_family IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'familyId',f.id,'familyVersion',f.version::text,'agreementId',g.id,'agreementVersion',g.version_no::text,'customer',crest_private.customer_projection(c),
 'vehicles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'label',v.label,'version',v.version::text,'archivedAt',to_char(v.archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY v.id) FROM crest.vehicles v WHERE v.business_id=requested_business AND EXISTS(SELECT 1 FROM crest.scope_entitlements e JOIN crest.scope_allocations s ON s.business_id=e.business_id AND s.entitlement_id=e.id WHERE e.business_id=requested_business AND s.agreement_id=g.id AND e.vehicle_id=v.id)),'[]'::jsonb),
 'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',s.id,'entitlementId',s.entitlement_id,'entitlementVersionId',s.entitlement_version_id,'agreementId',s.agreement_id,'sourcePartitionId',s.stable_partition_id,'vehicleId',e.vehicle_id,'jobWide',e.job_wide,'grossInclusiveCents',s.gross_inclusive_cents::text,'discountInclusiveCents',s.discount_inclusive_cents::text,'amountCents',s.amount_cents::text,'scopeDescription',s.scope_description,
 'planId',(SELECT p.id FROM crest.allocation_plan_versions p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id ORDER BY p.sequence DESC LIMIT 1),
 'planSequence',coalesce((SELECT p.sequence::text FROM crest.allocation_plan_versions p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id ORDER BY p.sequence DESC LIMIT 1),'0'),
 'parts',(SELECT jsonb_agg(jsonb_build_object('partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.stable_partition_id) FROM crest.current_scope_allocation_parts p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id)) ORDER BY s.id)
 FROM crest.scope_allocations s JOIN crest.scope_entitlements e ON e.business_id=s.business_id AND e.id=s.entitlement_id WHERE s.business_id=requested_business AND s.agreement_id=g.id),'[]'::jsonb)) INTO result
 FROM crest.quote_families f JOIN crest.quote_family_commercial_state control ON control.business_id=f.business_id AND control.family_id=f.id
 JOIN crest.agreements g ON g.business_id=f.business_id AND g.id=control.current_agreement_id AND g.family_id=f.id JOIN crest.customers c ON c.business_id=g.business_id AND c.id=g.customer_id
 WHERE f.business_id=requested_business AND f.id=requested_family;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_CONTEXT_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $agreement$;
CREATE FUNCTION crest_commands.read_confirmed_job_resources(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $resources$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',j.id,'head',crest_private.booking_job_display_snapshot(j),
 'vehicles',(SELECT jsonb_agg(crest_private.job_vehicles_projection(v) ORDER BY v.id) FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id),
 'encounters',(SELECT jsonb_agg(crest_private.job_encounters_projection(e) ORDER BY e.id) FROM crest.job_encounters e WHERE e.business_id=j.business_id AND e.job_id=j.id),
 'scopeParts',(SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',p.source_allocation_id,'entitlementId',p.entitlement_id,'entitlementVersionId',p.entitlement_version_id,'agreementId',p.agreement_id,'planId',p.plan_id,'planSequence',p.plan_sequence::text,'partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.source_allocation_id,p.stable_partition_id) FROM crest.current_scope_allocation_parts p WHERE p.business_id=j.business_id AND p.job_id=j.id)) INTO result FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_CONTEXT_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $resources$;
CREATE FUNCTION crest_commands.read_pending_job_changes(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,after_created timestamptz,after_appointment uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $pending$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF (after_created IS NULL)<>(after_appointment IS NULL) OR after_created IS NOT NULL AND(NOT isfinite(after_created) OR after_created<'0001-01-01T00:00:00Z'::timestamptz OR after_created>='10000-01-01T00:00:00Z'::timestamptz) OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH candidates AS MATERIALIZED(
  SELECT j,a.created_at AS proposed_at,a.id AS proposed_id FROM crest.appointments a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id JOIN crest.appointments current_ap ON current_ap.business_id=j.business_id AND current_ap.job_id=j.id AND current_ap.id=j.current_appointment_id
  WHERE a.business_id=requested_business AND a.confirmation_state='proposed' AND a.sequence>current_ap.sequence AND j.state NOT IN('completed','cancelled') AND NOT EXISTS(SELECT 1 FROM crest.appointments newer WHERE newer.business_id=a.business_id AND newer.job_id=a.job_id AND newer.sequence>a.sequence)
  AND(after_created IS NULL OR ROW(a.created_at,a.id)>ROW(after_created,after_appointment)) ORDER BY a.created_at,a.id LIMIT page_limit+1
 ),page AS(SELECT * FROM candidates ORDER BY proposed_at,proposed_id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'items',coalesce((SELECT jsonb_agg(jsonb_build_object('proposedAt',to_char(p.proposed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'head',crest_private.booking_job_display_snapshot(p.j)) ORDER BY p.proposed_at,p.proposed_id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*) FROM candidates)>page_limit) INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_READ_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN result;
END $pending$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_booking_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.read_booking_agreement(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_confirmed_job_resources(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_pending_job_changes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_booking_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.read_booking_agreement(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_confirmed_job_resources(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_pending_job_changes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer) TO crest_web;
