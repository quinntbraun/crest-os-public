-- PRODUCT P11, ACCOUNTING sections 4–5, DATABASE 7.2.
-- Read the exact retained work for invoice preparation. This does not reserve
-- scope, calculate tax, assign a number, or write an invoice or ledger entry.
SET LOCAL ROLE crest_schema_owner;

GRANT SELECT (id,business_id,state,customer_id,completion_outcome,completed_at) ON crest.jobs TO crest_finance_account_owner;
GRANT SELECT (id,business_id,job_id,completion_part_id,assigned_part_id,partition_id,outcome,completed_cents,scope_description,operation_id)
 ON crest.work_scope_outcomes TO crest_finance_account_owner;
GRANT SELECT (id,business_id,job_id,plan_id,stable_partition_id,allocation_state,gross_inclusive_cents,
 discount_inclusive_cents,amount_cents,scope_description,operation_id) ON crest.allocation_plan_parts TO crest_finance_account_owner;
GRANT SELECT (id,business_id,source_allocation_id,replaces_id,operation_id) ON crest.allocation_plan_versions TO crest_finance_account_owner;
GRANT SELECT (id,business_id,entitlement_version_id,entitlement_id,agreement_id) ON crest.scope_allocations TO crest_finance_account_owner;
GRANT SELECT (id,business_id,entitlement_id,agreement_id,family_id,source_quote_item_id) ON crest.entitlement_versions TO crest_finance_account_owner;
GRANT SELECT (id,business_id,agreement_family_id,vehicle_id,job_wide,stable_line_key) ON crest.scope_entitlements TO crest_finance_account_owner;
GRANT SELECT (id,business_id,family_id,customer_id) ON crest.agreements TO crest_finance_account_owner;
GRANT SELECT (id,business_id,stable_line_key,service_version_id,position,vehicle_id,job_wide) ON crest.quote_items TO crest_finance_account_owner;
GRANT SELECT (id,business_id,service_id) ON crest.service_versions TO crest_finance_account_owner;

CREATE POLICY invoice_preparation_jobs ON crest.jobs FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_preparation_outcomes ON crest.work_scope_outcomes FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_preparation_parts ON crest.allocation_plan_parts FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_preparation_plans ON crest.allocation_plan_versions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_preparation_allocations ON crest.scope_allocations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_preparation_entitlement_versions ON crest.entitlement_versions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_preparation_entitlements ON crest.scope_entitlements FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_preparation_agreements ON crest.agreements FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_preparation_quote_items ON crest.quote_items FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_preparation_service_versions ON crest.service_versions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);

CREATE FUNCTION crest_commands.read_invoice_preparation(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_job uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $preparation$
DECLARE saved_job record; lines jsonb; expected_count integer; retained_count integer;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_PREPARATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT state,customer_id,completion_outcome,completed_at INTO saved_job
 FROM crest.jobs WHERE (business_id,id)=(requested_business,requested_job);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved_job.state<>'completed' THEN RETURN jsonb_build_object('state','work_not_completed'); END IF;

 SELECT count(*) INTO expected_count FROM crest.work_scope_outcomes
  WHERE (business_id,job_id)=(requested_business,requested_job) AND outcome='completed';
 IF expected_count NOT BETWEEN 1 AND 10000 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_PREPARATION_SCOPE_REVIEW_REQUIRED';
 END IF;

 SELECT count(*),jsonb_agg(jsonb_build_object(
  'outcomeId',o.id,'completionPartId',part.id,'partitionId',o.partition_id,
  'agreementId',agreement.id,'entitlementVersionId',version.id,'quoteItemId',item.id,
  'vehicleId',entitlement.vehicle_id,'serviceId',service.service_id,'serviceVersionId',item.service_version_id,
  'description',o.scope_description,'grossInclusiveCents',part.gross_inclusive_cents::text,
  'discountInclusiveCents',part.discount_inclusive_cents::text,'inclusiveCents',part.amount_cents::text
 ) ORDER BY agreement.id,item.position,o.id) INTO retained_count,lines
 FROM crest.work_scope_outcomes o
 JOIN crest.allocation_plan_parts part ON (part.business_id,part.id,part.job_id,part.stable_partition_id)=
  (o.business_id,o.completion_part_id,o.job_id,o.partition_id)
 JOIN crest.allocation_plan_versions plan ON (plan.business_id,plan.id)=(part.business_id,part.plan_id)
 JOIN crest.allocation_plan_parts assigned ON (assigned.business_id,assigned.id,assigned.job_id)=
  (o.business_id,o.assigned_part_id,o.job_id) AND assigned.allocation_state='assigned'
 JOIN crest.allocation_plan_versions prior ON (prior.business_id,prior.id,prior.source_allocation_id)=
  (plan.business_id,assigned.plan_id,plan.source_allocation_id) AND prior.id=plan.replaces_id
 JOIN crest.scope_allocations allocation ON (allocation.business_id,allocation.id)=(plan.business_id,plan.source_allocation_id)
 JOIN crest.entitlement_versions version ON (version.business_id,version.id,version.entitlement_id,version.agreement_id)=
  (allocation.business_id,allocation.entitlement_version_id,allocation.entitlement_id,allocation.agreement_id)
 JOIN crest.scope_entitlements entitlement ON (entitlement.business_id,entitlement.id,entitlement.agreement_family_id)=
  (version.business_id,version.entitlement_id,version.family_id)
 JOIN crest.agreements agreement ON (agreement.business_id,agreement.id,agreement.family_id,agreement.customer_id)=
  (version.business_id,version.agreement_id,version.family_id,saved_job.customer_id)
 JOIN crest.quote_items item ON (item.business_id,item.id,item.stable_line_key)=
  (version.business_id,version.source_quote_item_id,entitlement.stable_line_key)
 LEFT JOIN crest.service_versions service ON (service.business_id,service.id)=(item.business_id,item.service_version_id)
 WHERE (o.business_id,o.job_id)=(requested_business,requested_job) AND o.outcome='completed'
  AND part.allocation_state='completed' AND o.completed_cents=part.amount_cents
  AND o.scope_description=part.scope_description AND o.operation_id=part.operation_id AND o.operation_id=plan.operation_id
  AND item.vehicle_id IS NOT DISTINCT FROM entitlement.vehicle_id AND item.job_wide=entitlement.job_wide
  AND (item.service_version_id IS NULL OR service.id IS NOT NULL);

 IF retained_count<>expected_count OR octet_length(lines::text)>800000 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_PREPARATION_SCOPE_REVIEW_REQUIRED';
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'state','ready','businessId',requested_business,'jobId',requested_job,
  'customerId',saved_job.customer_id,'completionOutcome',saved_job.completion_outcome,
  'completedAt',to_char(saved_job.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'lines',lines);
END $preparation$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_invoice_preparation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_invoice_preparation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_invoice_preparation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 TO crest_finance_preview;
