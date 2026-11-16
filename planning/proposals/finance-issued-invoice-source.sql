-- P01/P02 retained source and scope. The posting command will write these rows
-- alongside the numbered receipt, journal and receivable in one transaction.
SET LOCAL ROLE crest_schema_owner;

ALTER TABLE crest.invoice_number_reservations
 ADD CONSTRAINT invoice_number_source_identity UNIQUE(business_id,id,issued_source_id,full_number);

CREATE TABLE crest.invoices (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 draft_id uuid NOT NULL,
 draft_revision bigint NOT NULL,
 job_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 reservation_id uuid NOT NULL,
 invoice_number text NOT NULL,
 issued_on date NOT NULL CHECK(issued_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 due_on date NOT NULL CHECK(due_on BETWEEN issued_on AND DATE '9999-12-31'),
 time_zone text NOT NULL,
 customer_snapshot jsonb NOT NULL CHECK(jsonb_typeof(customer_snapshot)='object' AND customer_snapshot->'schemaVersion' IS NOT DISTINCT FROM '1'::jsonb),
 location_snapshot jsonb NOT NULL CHECK(jsonb_typeof(location_snapshot)='object' AND location_snapshot->'schemaVersion' IS NOT DISTINCT FROM '1'::jsonb),
 total_cents bigint NOT NULL CHECK(total_cents>=0),
 currency char(3) NOT NULL CHECK(currency='USD'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,draft_id),
 UNIQUE(business_id,reservation_id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,draft_id,draft_revision) REFERENCES crest.invoice_draft_revisions(business_id,draft_id,revision),
 FOREIGN KEY(business_id,job_id,customer_id) REFERENCES crest.jobs(business_id,id,customer_id),
 FOREIGN KEY(business_id,reservation_id,id,invoice_number)
  REFERENCES crest.invoice_number_reservations(business_id,id,issued_source_id,full_number),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE INDEX issued_invoice_job ON crest.invoices(business_id,job_id);
CREATE INDEX issued_invoice_customer ON crest.invoices(business_id,customer_id,issued_on,id);

CREATE TABLE crest.invoice_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 180),
 outcome_id uuid NOT NULL,
 completion_part_id uuid NOT NULL,
 partition_id uuid NOT NULL,
 agreement_id uuid NOT NULL,
 entitlement_version_id uuid NOT NULL,
 service_version_id uuid NOT NULL,
 tax_profile_id uuid NOT NULL,
 exemption_evidence_id uuid,
 gross_inclusive_cents bigint NOT NULL CHECK(gross_inclusive_cents>=0),
 discount_inclusive_cents bigint NOT NULL CHECK(discount_inclusive_cents>=0),
 gross_net_cents bigint NOT NULL CHECK(gross_net_cents>=0),
 discount_net_cents bigint NOT NULL CHECK(discount_net_cents>=0),
 net_cents bigint NOT NULL CHECK(net_cents>=0),
 tax_cents bigint NOT NULL CHECK(tax_cents>=0),
 total_cents bigint NOT NULL CHECK(total_cents>=0),
 description text NOT NULL CHECK(char_length(btrim(description)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,invoice_id,position),
 UNIQUE(business_id,outcome_id),
 UNIQUE(business_id,completion_part_id),
 FOREIGN KEY(business_id,invoice_id) REFERENCES crest.invoices(business_id,id),
 FOREIGN KEY(business_id,outcome_id) REFERENCES crest.work_scope_outcomes(business_id,id),
 FOREIGN KEY(business_id,completion_part_id) REFERENCES crest.allocation_plan_parts(business_id,id),
 FOREIGN KEY(business_id,agreement_id) REFERENCES crest.agreements(business_id,id),
 FOREIGN KEY(business_id,entitlement_version_id) REFERENCES crest.entitlement_versions(business_id,id),
 FOREIGN KEY(business_id,service_version_id) REFERENCES crest.service_versions(business_id,id),
 FOREIGN KEY(business_id,tax_profile_id) REFERENCES crest.tax_profiles(business_id,id),
 FOREIGN KEY(business_id,exemption_evidence_id) REFERENCES crest.invoice_exemption_evidence(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK(gross_inclusive_cents::numeric-discount_inclusive_cents::numeric=total_cents),
 CHECK(gross_net_cents::numeric-discount_net_cents::numeric=net_cents),
 CHECK(net_cents::numeric+tax_cents::numeric=total_cents)
);
CREATE INDEX issued_invoice_item_agreement ON crest.invoice_items(business_id,agreement_id);
CREATE INDEX issued_invoice_item_entitlement ON crest.invoice_items(business_id,entitlement_version_id);
CREATE INDEX issued_invoice_item_service ON crest.invoice_items(business_id,service_version_id);
CREATE INDEX issued_invoice_item_tax ON crest.invoice_items(business_id,tax_profile_id);
CREATE INDEX issued_invoice_item_exemption ON crest.invoice_items(business_id,exemption_evidence_id);
CREATE INDEX issued_invoice_item_operation ON crest.invoice_items(business_id,operation_id);

-- The first issue consumes the entire fulfilled partition, including a zero
-- amount. A correction must retain this original row and its unique partition.
CREATE TABLE crest.billing_consumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 invoice_item_id uuid NOT NULL,
 partition_id uuid NOT NULL,
 consumed_cents bigint NOT NULL CHECK(consumed_cents>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,invoice_item_id),
 UNIQUE(business_id,partition_id),
 FOREIGN KEY(business_id,invoice_item_id) REFERENCES crest.invoice_items(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE INDEX billing_consumption_operation ON crest.billing_consumptions(business_id,operation_id);

ALTER TABLE crest.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_items FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.billing_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.billing_consumptions FORCE ROW LEVEL SECURITY;
CREATE TRIGGER issued_invoice_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoices
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER issued_invoice_item_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoice_items
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER billing_consumption_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.billing_consumptions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

GRANT SELECT ON crest.invoices,crest.invoice_items,crest.billing_consumptions,
 crest.invoice_number_reservations TO crest_finance_integrity_owner;
CREATE POLICY issued_invoice_integrity ON crest.invoices FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY issued_invoice_item_integrity ON crest.invoice_items FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY billing_consumption_integrity ON crest.billing_consumptions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY issued_invoice_number_integrity ON crest.invoice_number_reservations FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY issued_invoice_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.invoice.issue');
CREATE POLICY issued_invoice_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='invoices' AND action='issue');
GRANT SELECT(business_id,id,display_name) ON crest.customers TO crest_finance_integrity_owner;
CREATE POLICY issued_invoice_customer_integrity ON crest.customers FOR SELECT TO crest_finance_integrity_owner USING(true);
GRANT SELECT(work_location_snapshot,state,completed_at) ON crest.jobs TO crest_finance_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.finance_tax_charge(bigint,bigint,numeric) TO crest_finance_integrity_owner;

CREATE FUNCTION crest_private.verify_issued_invoice_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE issued crest.invoices; draft crest.invoice_draft_revisions; number crest.invoice_number_reservations;
 count_items bigint; sum_items numeric;
BEGIN
 IF TG_TABLE_NAME='invoices' THEN issued:=NEW;
 ELSIF TG_TABLE_NAME='invoice_items' THEN
  SELECT i.* INTO STRICT issued FROM crest.invoices i WHERE (i.business_id,i.id)=(NEW.business_id,NEW.invoice_id);
 ELSE
  SELECT i.* INTO STRICT issued FROM crest.invoices i JOIN crest.invoice_items item
   ON (item.business_id,item.invoice_id)=(i.business_id,i.id)
   WHERE (item.business_id,item.id)=(NEW.business_id,NEW.invoice_item_id);
 END IF;
 SELECT d.* INTO STRICT draft FROM crest.invoice_draft_revisions d
  WHERE (d.business_id,d.draft_id,d.revision)=(issued.business_id,issued.draft_id,issued.draft_revision);
 SELECT n.* INTO STRICT number FROM crest.invoice_number_reservations n
  WHERE (n.business_id,n.id)=(issued.business_id,issued.reservation_id);
 IF draft.state<>'draft' OR (draft.job_id,draft.customer_id)<>(issued.job_id,issued.customer_id)
  OR issued.due_on<>coalesce(draft.due_on,issued.issued_on)
  OR (number.created_by,number.operation_id)<>(issued.created_by,issued.operation_id)
  OR number.incident_id IS NOT NULL OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=issued.time_zone)
  OR NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
   WHERE (o.business_id,o.operation_id,o.actor_id)=(issued.business_id,issued.operation_id,issued.created_by)
    AND o.command_type='finance.invoice.issue' AND o.state='committed'
    AND o.result->>'invoiceId'=issued.id::text AND o.result->>'invoiceNumber'=issued.invoice_number
    AND (a.entity_kind,a.entity_id,a.entity_version,a.action)=('invoices',issued.id,1::bigint,'issue')
    AND a.delta->'before'='null'::jsonb AND a.delta->'after' IS NOT DISTINCT FROM o.result)
  OR NOT EXISTS(SELECT FROM crest.jobs j JOIN crest.customers c ON (c.business_id,c.id)=(j.business_id,j.customer_id)
   WHERE (j.business_id,j.id,j.customer_id)=(issued.business_id,issued.job_id,issued.customer_id)
    AND j.state='completed' AND (j.completed_at AT TIME ZONE issued.time_zone)::date<=issued.issued_on
    AND issued.customer_snapshot=jsonb_build_object('schemaVersion',1,'id',c.id,'displayName',c.display_name)
    AND issued.location_snapshot=j.work_location_snapshot) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ISSUED_INVOICE_SOURCE_REQUIRED';
 END IF;
 SELECT count(*),sum(item.total_cents) INTO count_items,sum_items
 FROM crest.invoice_items item WHERE (item.business_id,item.invoice_id)=(issued.business_id,issued.id);
 IF count_items<>cardinality(draft.selected_outcomes) OR count_items=0 OR sum_items<>issued.total_cents THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ISSUED_INVOICE_TOTAL_REQUIRED';
 END IF;
 IF EXISTS(SELECT FROM crest.invoice_items item
  LEFT JOIN crest.billing_consumptions c ON (c.business_id,c.invoice_item_id)=(item.business_id,item.id)
  JOIN crest.tax_profiles profile ON (profile.business_id,profile.id)=(item.business_id,item.tax_profile_id)
  CROSS JOIN LATERAL (SELECT draft.retained_lines->(item.position-1) AS line) d
  CROSS JOIN LATERAL (SELECT crest_private.finance_tax_charge(
   item.gross_inclusive_cents,item.discount_inclusive_cents,coalesce(profile.rate,0)) AS amounts) charge
  WHERE (item.business_id,item.invoice_id)=(issued.business_id,issued.id) AND (
   d.line IS NULL OR profile.treatment NOT IN('non_taxable','inclusive_single','exempt') OR profile.effective_from>issued.issued_on
   OR profile.applicability<>'service' OR profile.synthetic IS DISTINCT FROM true
   OR (profile.treatment='exempt')<>(item.exemption_evidence_id IS NOT NULL)
   OR (profile.treatment='exempt' AND NOT EXISTS(
    SELECT FROM crest.invoice_exemption_evidence e WHERE (e.business_id,e.id,e.draft_id,e.draft_revision,e.outcome_id,e.customer_id,e.jurisdiction,e.profile_id)=
     (issued.business_id,item.exemption_evidence_id,issued.draft_id,issued.draft_revision,item.outcome_id,
      issued.customer_id,profile.jurisdiction,profile.id)
    AND issued.issued_on BETWEEN e.valid_from AND e.valid_through
    AND NOT EXISTS(SELECT FROM crest.invoice_exemption_evidence newer
     WHERE (newer.business_id,newer.draft_id,newer.draft_revision,newer.outcome_id,newer.profile_id)=
      (e.business_id,e.draft_id,e.draft_revision,e.outcome_id,e.profile_id) AND newer.version>e.version)
   ))
   OR profile.service_id IS DISTINCT FROM (d.line->>'serviceId')::uuid
   OR EXISTS(SELECT FROM crest.tax_profiles newer
    WHERE (newer.business_id,newer.jurisdiction,newer.scope_key)=(profile.business_id,profile.jurisdiction,profile.scope_key)
     AND newer.effective_from>profile.effective_from AND newer.effective_from<=issued.issued_on)
   OR (item.outcome_id,item.completion_part_id,item.partition_id,item.agreement_id,item.entitlement_version_id,item.service_version_id,
    item.gross_inclusive_cents,item.discount_inclusive_cents,item.description) IS DISTINCT FROM
    ((d.line->>'outcomeId')::uuid,(d.line->>'completionPartId')::uuid,(d.line->>'partitionId')::uuid,
     (d.line->>'agreementId')::uuid,(d.line->>'entitlementVersionId')::uuid,(d.line->>'serviceVersionId')::uuid,
     (d.line->>'grossInclusiveCents')::bigint,(d.line->>'discountInclusiveCents')::bigint,d.line->>'description')
   OR (item.gross_net_cents,item.discount_net_cents,item.net_cents,item.tax_cents) IS DISTINCT FROM
    ((charge.amounts->>'grossNetCents')::bigint,(charge.amounts->>'discountNetCents')::bigint,
     (charge.amounts->>'netCents')::bigint,(charge.amounts->>'taxCents')::bigint)
   OR (item.created_by,item.operation_id)<>(issued.created_by,issued.operation_id)
   OR (c.partition_id,c.consumed_cents,c.created_by,c.operation_id) IS DISTINCT FROM
    (item.partition_id,item.total_cents,issued.created_by,issued.operation_id)
  )) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ISSUED_INVOICE_SCOPE_AND_CHARGE_REQUIRED';
 END IF;
 RETURN NULL;
END $verify$;

CREATE CONSTRAINT TRIGGER issued_invoice_source AFTER INSERT ON crest.invoices
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_issued_invoice_source();
CREATE CONSTRAINT TRIGGER issued_invoice_item_source AFTER INSERT ON crest.invoice_items
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_issued_invoice_source();
CREATE CONSTRAINT TRIGGER billing_consumption_source AFTER INSERT ON crest.billing_consumptions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_issued_invoice_source();
RESET ROLE;
ALTER FUNCTION crest_private.verify_issued_invoice_source() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_issued_invoice_source() FROM PUBLIC;
