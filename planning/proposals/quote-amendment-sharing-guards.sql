-- UNREGISTERED companion: apply sharing core and guards atomically after storage/Draft proposals.
-- No registry, owner installation, external transmission or customer acceptance is activated.
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.stamp_quote_commercial()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$ DECLARE stamp timestamptz:=clock_timestamp();BEGIN IF TG_OP='INSERT' THEN NEW.created_at:=stamp;IF NEW.version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_HISTORY_REQUIRED';END IF;ELSE IF TG_TABLE_NAME<>'quote_family_commercial_state' OR ROW(NEW.id,NEW.business_id,NEW.family_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.family_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) OR NEW.version<>OLD.version+1 OR (OLD.initial_acceptance_id IS NOT NULL AND (NEW.initial_acceptance_id IS DISTINCT FROM OLD.initial_acceptance_id OR NEW.current_agreement_id IS DISTINCT FROM OLD.current_agreement_id OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type='quote.amendment.send' AND schema_version=1))) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_COMMERCIAL_HISTORY_RETAINED';END IF;END IF;NEW.updated_at:=stamp;IF TG_TABLE_NAME='quote_sends' THEN NEW.confirmed_at:=stamp;ELSIF TG_TABLE_NAME='quote_acceptances' THEN NEW.recorded_at:=stamp;END IF;RETURN NEW;END $function$
;
CREATE OR REPLACE FUNCTION crest_private.validate_quote_revision_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE parent crest.quote_families; preceding bigint; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO parent FROM crest.quote_families WHERE business_id=NEW.business_id AND id=NEW.family_id FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_QUOTE_PARENT_REQUIRED';END IF;
 IF TG_OP='UPDATE' AND (OLD.state IN('Sent','Accepted','Superseded','Declined','Cancelled') OR NEW.state IN('Sent','Accepted','Superseded','Declined','Cancelled')) THEN
  IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['version','state','updated_at','updated_by','operation_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','updated_at','updated_by','operation_id']) OR OLD.state='Accepted' OR NOT(OLD.state='Ready for Review' AND NEW.state='Sent' OR OLD.state='Sent' AND NEW.state IN('Sent','Accepted','Superseded','Declined','Cancelled') OR OLD.state IN('Draft','Ready for Review') AND NEW.state='Cancelled') OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND schema_version=1 AND command_type IN('quote.manual.send','quote.confirmation.accept','quote.amendment.send')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_SENT_CONTENT_FROZEN';END IF;NEW.updated_at:=stamp;RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT coalesce(max(sequence),0) INTO preceding FROM crest.quote_revisions WHERE business_id=NEW.business_id AND family_id=NEW.family_id;
  IF NEW.sequence::numeric<>preceding::numeric+1 OR NEW.version<>1 OR NEW.content_version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;NEW.created_at:=stamp;
 ELSE
  IF ROW(NEW.id,NEW.business_id,NEW.family_id,NEW.sequence,NEW.kind,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.family_id,OLD.sequence,OLD.kind,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_PROVENANCE_RETAINED';END IF;
  IF NEW.version::numeric<>OLD.version::numeric+1 OR NEW.customer_safe_snapshot->>'schemaVersion'='1' AND OLD.customer_safe_snapshot->>'schemaVersion'='2' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
  IF NEW.canonical_content<>OLD.canonical_content THEN
   IF NEW.content_version::numeric<>OLD.content_version::numeric+1 OR NEW.state<>'Draft' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
  ELSIF NEW.content_version<>OLD.content_version OR ROW(NEW.customer_safe_snapshot,NEW.internal_snapshot,NEW.content_hash,NEW.total_cents,NEW.expiry_at,NEW.timezone,NEW.tax_readiness) IS DISTINCT FROM ROW(OLD.customer_safe_snapshot,OLD.internal_snapshot,OLD.content_hash,OLD.total_cents,OLD.expiry_at,OLD.timezone,OLD.tax_readiness) OR NOT(OLD.state='Draft' AND NEW.state='Ready for Review' OR OLD.state='Ready for Review' AND NEW.state='Ready for Review') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
 END IF;
 IF NEW.internal_snapshot->>'customerId' IS DISTINCT FROM (CASE WHEN NEW.kind='amendment' THEN (SELECT g.customer_id::text FROM crest.agreements g WHERE g.business_id=NEW.business_id AND g.family_id=NEW.family_id AND g.id=NEW.parent_agreement_id) ELSE parent.customer_id::text END) OR NEW.internal_snapshot->>'leadId' IS DISTINCT FROM parent.lead_id::text
  OR NEW.customer_safe_snapshot->>'currency' IS DISTINCT FROM 'USD' OR NEW.customer_safe_snapshot->'schemaVersion' NOT IN('1'::jsonb,'2'::jsonb)
  OR NEW.customer_safe_snapshot->>'totalCents' IS DISTINCT FROM NEW.total_cents::text OR NEW.customer_safe_snapshot->>'timezone' IS DISTINCT FROM NEW.timezone
  OR NEW.customer_safe_snapshot->>'expiryAt' IS DISTINCT FROM (CASE WHEN NEW.expiry_at IS NULL THEN NULL ELSE to_char(NEW.expiry_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_SNAPSHOT_CONFLICT';END IF;
 IF NEW.kind='amendment' AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.internal_snapshot->'sources') s JOIN crest.scope_entitlements e ON e.business_id=NEW.business_id AND e.agreement_family_id=NEW.family_id AND e.stable_line_key=(s->>'stableLineKey')::uuid WHERE e.vehicle_id IS DISTINCT FROM (s->>'vehicleId')::uuid OR e.job_wide IS DISTINCT FROM (s->>'jobWide')::boolean) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_SCOPE_IDENTITY_RETAINED';END IF;
 IF TG_OP='UPDATE' AND NEW.canonical_content=OLD.canonical_content THEN
  IF NOT crest_private.quote_review_ready(jsonb_build_object('customer',NEW.customer_safe_snapshot,'internal',NEW.internal_snapshot,'canonical',NEW.canonical_content)) OR NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.updated_by AND o.command_type=(CASE WHEN OLD.state='Draft' THEN 'quote.review.submit' ELSE 'quote.review.approve' END) AND o.schema_version=1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_REQUIRED';END IF;
 END IF;NEW.updated_at:=stamp;RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
GRANT EXECUTE ON FUNCTION crest_private.amendment_send_result(uuid,uuid,uuid) TO crest_quote_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_quote_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE prior jsonb:='null'::jsonb; following jsonb; kind text:=TG_TABLE_NAME; source jsonb; published boolean;
BEGIN
 IF kind='quote_families' THEN
  following:=crest_private.quote_family_projection(NEW::crest.quote_families);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_family_projection(OLD::crest.quote_families);END IF;
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_revisions r ON r.business_id=a.business_id AND r.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_revisions'
    AND a.entity_id=NEW.current_revision_id AND a.entity_version<=r.version AND r.family_id=NEW.id
    AND a.delta->'after'->>'version'=a.entity_version::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text) INTO published;
 ELSIF kind='quote_revisions' THEN
  following:=crest_private.quote_revision_projection(NEW::crest.quote_revisions);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_revision_projection(OLD::crest.quote_revisions);END IF;
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_families f ON f.business_id=a.business_id AND f.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_families'
    AND a.entity_id=NEW.family_id AND a.entity_version<=f.version AND a.delta->'after'->>'version'=a.entity_version::text
    AND a.delta->'after'->>'current_revision_id'=NEW.id::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text) INTO published;
 ELSIF kind='quote_items' THEN
  following:=crest_private.quote_item_projection(NEW::crest.quote_items);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_item_projection(OLD::crest.quote_items);END IF;
  source:=jsonb_build_object('stableLineKey',NEW.stable_line_key,'vehicleId',NEW.vehicle_id,'jobWide',NEW.job_wide,'serviceVersionId',NEW.service_version_id)||(CASE WHEN NEW.customer_snapshot?'category' THEN jsonb_build_object('assessment',CASE WHEN NEW.assessment_id IS NULL THEN 'null'::jsonb ELSE (SELECT crest_private.quote_assessment_packet(a) FROM crest.condition_assessments a WHERE a.business_id=NEW.business_id AND a.id=NEW.assessment_id AND a.vehicle_id=NEW.vehicle_id) END,'categoryOverrideNote',NEW.category_override_note) ELSE '{}'::jsonb END);
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_revisions r ON r.business_id=a.business_id AND r.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_revisions' AND a.entity_id=NEW.revision_id
    AND a.entity_version<=r.version AND a.delta->'after'->>'version'=a.entity_version::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text
    AND (NEW.active AND a.delta->'after'->'internal_snapshot'->'sources'->(NEW.position-1)=source AND a.delta->'after'->'customer_safe_snapshot'->'lines'->(NEW.position-1)=NEW.customer_snapshot
     OR NOT NEW.active AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.delta->'after'->'internal_snapshot'->'sources') s WHERE s->>'stableLineKey'=NEW.stable_line_key::text))) INTO published;
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 IF kind IN('quote_families','quote_revisions') AND EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type IN('quote.manual.send','quote.confirmation.accept','quote.amendment.send')) THEN
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=CASE WHEN kind='quote_families' THEN 'quote_revisions' ELSE 'quote_families' END AND (kind='quote_families' AND a.delta->'after'->>'family_id'=NEW.id::text OR kind='quote_revisions' AND a.entity_id::text=(to_jsonb(NEW)->>'family_id'))) INTO published;
 END IF;
 IF NOT published OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id
  WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=kind AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action=(CASE o.command_type WHEN 'quote.review.submit' THEN 'submit' WHEN 'quote.review.approve' THEN 'approve' WHEN 'quote.manual.send' THEN 'send' WHEN 'quote.amendment.send' THEN 'send' WHEN 'quote.confirmation.accept' THEN 'accept' ELSE CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'edit' END END) AND a.delta->'before'=prior AND a.delta->'after'=following
   AND (o.command_type IN('quote.draft.save','quote.replacement.create') AND o.schema_version IN(1,2) OR o.command_type='quote.amendment.create' AND o.schema_version=3 OR o.command_type IN('quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept','quote.amendment.send') AND o.schema_version=1 AND kind IN('quote_families','quote_revisions') AND TG_OP='UPDATE') AND o.origin=NEW.origin AND o.import_row_id IS NOT DISTINCT FROM NEW.import_row_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
CREATE OR REPLACE FUNCTION crest_private.check_quote_commercial_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$ DECLARE image jsonb;prior jsonb:='null'::jsonb;o crest_private.operations;receipt jsonb;member boolean;BEGIN
 CASE TG_TABLE_NAME
 WHEN 'quote_family_commercial_state' THEN image:=crest_private.quote_family_commercial_state_projection(NEW::crest.quote_family_commercial_state);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_family_commercial_state_projection(OLD::crest.quote_family_commercial_state);END IF;
 WHEN 'quote_sends' THEN image:=crest_private.quote_sends_projection(NEW::crest.quote_sends);
 WHEN 'quote_acceptances' THEN image:=crest_private.quote_acceptances_projection(NEW::crest.quote_acceptances);
 WHEN 'agreements' THEN image:=crest_private.agreements_projection(NEW::crest.agreements);
 WHEN 'scope_entitlements' THEN image:=crest_private.scope_entitlements_projection(NEW::crest.scope_entitlements);
 WHEN 'entitlement_versions' THEN image:=crest_private.entitlement_versions_projection(NEW::crest.entitlement_versions);
 WHEN 'scope_allocations' THEN image:=crest_private.scope_allocations_projection(NEW::crest.scope_allocations);
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END CASE;
 IF EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type='quote.amendment.send' AND schema_version=1) THEN
  receipt:=crest_private.amendment_send_result(NEW.business_id,NEW.updated_by,NEW.operation_id)->'receipt';
  member:=CASE WHEN TG_TABLE_NAME='quote_sends' AND TG_OP='INSERT' THEN receipt->>'sendId'=NEW.id::text WHEN TG_TABLE_NAME='quote_family_commercial_state' AND TG_OP='UPDATE' THEN receipt->>'familyId'=NEW.id::text AND receipt->>'commercialStateVersion'=NEW.version::text ELSE false END;
  IF member IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND actor_id=NEW.updated_by AND operation_id=NEW.operation_id AND entity_kind=TG_TABLE_NAME AND entity_id=NEW.id AND entity_version=NEW.version AND action='send' AND delta->'before'=prior AND delta->'after'=image) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_SEND_RESULT_REVIEW_REQUIRED';END IF;RETURN NULL;
 END IF;
 SELECT command_type,result,schema_version,state INTO o.command_type,o.result,o.schema_version,o.state FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type IN('quote.manual.send','quote.confirmation.accept') AND schema_version=1 AND state='committed';IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;receipt:=o.result;
 member:=CASE TG_TABLE_NAME WHEN 'quote_family_commercial_state' THEN receipt->>'familyId'=NEW.id::text AND receipt->>'commercialStateVersion'=NEW.version::text WHEN 'quote_sends' THEN receipt->>'action'='send' AND receipt->>'sendId'=NEW.id::text WHEN 'quote_acceptances' THEN receipt->>'acceptanceId'=NEW.id::text WHEN 'agreements' THEN receipt->>'agreementId'=NEW.id::text WHEN 'scope_entitlements' THEN receipt->'entitlementIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'entitlement_versions' THEN receipt->'entitlementVersionIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'scope_allocations' THEN receipt->'allocationIds' @> to_jsonb(ARRAY[NEW.id]) ELSE false END;
 IF member IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND actor_id=NEW.updated_by AND operation_id=NEW.operation_id AND entity_kind=TG_TABLE_NAME AND entity_id=NEW.id AND entity_version=NEW.version AND action=receipt->>'action' AND delta->'before'=prior AND delta->'after'=image) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;RETURN NULL;END $function$
;
CREATE FUNCTION crest_private.check_quote_amendment_send_operation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
BEGIN IF NEW.command_type='quote.amendment.send' THEN
 PERFORM set_config('crest.business_id',NEW.business_id::text,true),set_config('crest.actor_id',NEW.actor_id::text,true);
 IF NEW.schema_version<>1 OR crest_private.amendment_send_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_SEND_RESULT_REVIEW_REQUIRED';END IF;
END IF;RETURN NULL;END $$;
REVOKE ALL ON FUNCTION crest_private.check_quote_amendment_send_operation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_quote_amendment_send_operation() TO crest_schema_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER quote_amendment_send_operation_integrity AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_amendment_send_operation();
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_quote_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner;
RESET ROLE;
