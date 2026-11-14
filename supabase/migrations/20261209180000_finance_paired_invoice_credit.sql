-- Held E08 paired invoice credit and private source. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-credit-paired.sql
-- Held E08a/E08b: exact single selected P03 release + P07 in one group.
-- Applies after reviewed schema 84. No cash outflow or P08 capability.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.paired_invoice_credit_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 invoice_credit_id uuid NOT NULL,
 unapplication_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 reviewed_ar_cents bigint NOT NULL CHECK(reviewed_ar_cents>=0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,invoice_credit_id),
 UNIQUE(business_id,unapplication_id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,invoice_credit_id) REFERENCES crest.invoice_credits(business_id,id),
 FOREIGN KEY(business_id,unapplication_id) REFERENCES crest.allocation_unapplications(business_id,id),
 FOREIGN KEY(business_id,operation_id,actor_id) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.paired_invoice_credit_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.paired_invoice_credit_releases FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.paired_invoice_credit_releases TO crest_finance_integrity_owner;
GRANT SELECT,INSERT ON crest.paired_invoice_credit_releases TO crest_finance_account_owner;
CREATE POLICY paired_credit_integrity ON crest.paired_invoice_credit_releases FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY paired_credit_read ON crest.paired_invoice_credit_releases FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE TRIGGER paired_credit_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.paired_invoice_credit_releases
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE POLICY paired_credit_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.invoice.credit_paired');
CREATE POLICY paired_credit_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice.credit_paired');
CREATE POLICY paired_credit_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice.credit_paired' AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY paired_credit_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice.credit_paired' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice.credit_paired' AND state='committed');
CREATE POLICY paired_credit_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND ((entity_kind='invoice_credits' AND action='credit') OR (entity_kind='allocation_unapplications' AND action='unapply'))
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.invoice.credit_paired' AND o.state='pending'));
DO $writer$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['paired_invoice_credit_releases','invoice_credits','allocation_unapplications','customer_fund_lots',
  'financial_events','atomic_finance_groups','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE POLICY paired_credit_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o
     WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
      AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
      AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
      AND o.command_type=''finance.invoice.credit_paired'' AND o.state=''pending''))',source);
 END LOOP;
END $writer$;

CREATE FUNCTION crest_private.verify_paired_invoice_credit_release() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE c crest.invoice_credits; u crest.allocation_unapplications; p05 crest.financial_events; p07 crest.financial_events;
 a crest.allocation_events; l crest.customer_fund_lots; r crest.receivable_items; group_row crest.atomic_finance_groups;
 original_ar numeric; operation_result jsonb;
BEGIN
 SELECT * INTO STRICT c FROM crest.invoice_credits WHERE business_id=NEW.business_id AND id=NEW.invoice_credit_id;
 SELECT * INTO STRICT u FROM crest.allocation_unapplications WHERE business_id=NEW.business_id AND id=NEW.unapplication_id;
 SELECT * INTO STRICT a FROM crest.allocation_events WHERE business_id=NEW.business_id AND id=u.allocation_id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=NEW.business_id AND unapplication_id=u.id;
 SELECT * INTO STRICT r FROM crest.receivable_items WHERE business_id=NEW.business_id AND id=c.receivable_id;
 SELECT * INTO STRICT p05 FROM crest.financial_events WHERE business_id=NEW.business_id AND unapplication_id=u.id;
 SELECT * INTO STRICT p07 FROM crest.financial_events WHERE business_id=NEW.business_id AND invoice_credit_id=c.id;
 SELECT * INTO STRICT group_row FROM crest.atomic_finance_groups WHERE business_id=NEW.business_id AND id=p05.group_id;
 SELECT r.original_cents+coalesce(sum(d.signed_cents),0) INTO original_ar
 FROM crest_private.receivable_posted_deltas(r.business_id,r.id) d
 WHERE (d.effective_on,d.commit_sequence)<(p05.effective_on,group_row.commit_sequence);
 SELECT o.result INTO operation_result FROM crest_private.operations o
 WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.actor_id
  AND o.command_type='finance.invoice.credit_paired' AND o.state='committed';
 IF (p05.template,p05.event_sequence,p07.template,p07.event_sequence) IS DISTINCT FROM ('P05'::text,1,'P07'::text,2)
  OR (p05.group_id,p05.period_id,p05.period_generation,p05.effective_on,p05.time_zone)
   IS DISTINCT FROM (p07.group_id,p07.period_id,p07.period_generation,p07.effective_on,p07.time_zone)
  OR (c.operation_id,c.created_by,u.operation_id,u.created_by,group_row.operation_id,group_row.created_by)
   IS DISTINCT FROM (NEW.operation_id,NEW.actor_id,NEW.operation_id,NEW.actor_id,NEW.operation_id,NEW.actor_id)
  OR c.receivable_id<>a.receivable_id OR c.reason<>u.reason OR original_ar<>NEW.reviewed_ar_cents
  OR l.original_cents::numeric<>c.inclusive_cents::numeric-original_ar OR c.inclusive_cents<=original_ar
  OR (SELECT count(*) FROM crest.financial_events e WHERE e.business_id=NEW.business_id AND e.group_id=group_row.id)<>2
  OR operation_result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,
   'credit',crest_private.fictional_invoice_credit_receipt(c,p07,r),'release',crest_private.fictional_unapplication_receipt(u,l,p05,r))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_SOURCE_REQUIRED';END IF;
 RETURN NULL;
END $verify$;
RESET ROLE;
ALTER FUNCTION crest_private.verify_paired_invoice_credit_release() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_paired_invoice_credit_release() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_paired_invoice_credit_release() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER paired_credit_complete AFTER INSERT ON crest.paired_invoice_credit_releases
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_paired_invoice_credit_release();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_paired_invoice_credit_release() FROM crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.verify_fictional_unapplication(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; original crest.financial_events; u crest.allocation_unapplications; l crest.customer_fund_lots;
 a crest.allocation_events; r crest.receivable_items; parent crest.funding_partitions; root crest.funding_origins;
 journal uuid; receipt jsonb; cents bigint;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT u FROM crest.allocation_unapplications WHERE business_id=requested_business AND id=e.unapplication_id;
 SELECT * INTO STRICT a FROM crest.allocation_events WHERE business_id=requested_business AND id=u.allocation_id;
 SELECT * INTO STRICT original FROM crest.financial_events WHERE business_id=requested_business AND id=a.event_id;
 SELECT * INTO STRICT r FROM crest.receivable_items WHERE business_id=requested_business AND id=a.receivable_id;
 SELECT * INTO STRICT parent FROM crest.funding_partitions WHERE business_id=requested_business AND id=a.partition_id;
 SELECT * INTO STRICT root FROM crest.funding_origins WHERE business_id=requested_business AND id=parent.origin_id;
 SELECT * INTO l FROM crest.customer_fund_lots WHERE business_id=requested_business AND unapplication_id=u.id;
 SELECT id INTO journal FROM crest.journal_entries WHERE business_id=requested_business AND event_id=e.id AND entry_sequence=1;
 cents:=u.last_cent-u.first_cent+1;
 receipt:=crest_private.fictional_unapplication_receipt(u,l,e,r);
 IF e.template<>'P05' OR e.event_sequence<>1 OR original.template<>'P03' OR e.effective_on<original.effective_on
  OR u.first_cent<parent.first_cent OR u.last_cent>parent.last_cent OR cents>a.cents
  OR e.posted_at<u.created_at OR e.effective_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR l.id IS NULL OR (l.origin_id,l.parent_partition_id,l.customer_id,l.original_cents) IS DISTINCT FROM (root.id,parent.id,r.customer_id,cents)
  OR root.customer_id<>r.customer_id OR l.mapping_id IS DISTINCT FROM crest_private.unapplication_funds_mapping(requested_business,e.effective_on)
  OR NOT EXISTS(SELECT FROM crest.account_mapping_versions m WHERE m.business_id=l.business_id AND m.id=l.mapping_id AND m.account_id=l.account_id)
  OR NOT crest_private.receivable_has_nonnegative_history(r.business_id,r.id,r.original_cents)
  OR NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
   JOIN crest.atomic_finance_groups prior ON prior.business_id=original.business_id AND prior.id=original.group_id
   JOIN crest_private.operations o ON o.business_id=g.business_id AND o.operation_id=g.operation_id AND o.actor_id=g.created_by
   JOIN crest_private.audit_events audit ON audit.business_id=o.business_id AND audit.operation_id=o.operation_id AND audit.actor_id=o.actor_id
   JOIN crest.accounting_periods p ON p.business_id=e.business_id AND p.id=e.period_id
   WHERE g.business_id=e.business_id AND g.id=e.group_id AND g.operation_id=u.operation_id AND g.created_by=u.created_by
    AND g.commit_sequence>prior.commit_sequence AND g.recovery_epoch=o.recovery_epoch
    AND o.state='committed' AND (
      (o.command_type='finance.allocation.unapply' AND o.result=receipt) OR
      (o.command_type='finance.invoice.credit_paired' AND o.result->'release'=receipt
       AND EXISTS(SELECT FROM crest.paired_invoice_credit_releases link
        WHERE link.business_id=u.business_id AND link.unapplication_id=u.id AND link.operation_id=u.operation_id)))
    AND audit.entity_kind='allocation_unapplications' AND audit.entity_id=u.id AND audit.entity_version=1 AND audit.action='unapply'
    AND audit.reason=u.reason AND audit.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
    AND e.time_zone=p.time_zone AND e.effective_on>=p.starts_on AND e.effective_on<=p.through_on
    AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
     WHERE h.business_id=p.business_id AND h.period_id=p.id),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_SOURCE_REQUIRED';END IF;

 IF journal IS NULL OR (SELECT count(*) FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id)<>1
  OR (SELECT count(*) FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal)<>2
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
    AND x.purpose='unapply_ar' AND x.receivable_id=r.id AND x.account_id=r.account_id AND x.debit_cents=cents AND x.unapplication_id=u.id)
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
    AND x.purpose='unapply_funds' AND x.fund_lot_id=l.id AND x.account_id=l.account_id AND x.fixed_mapping_id=l.mapping_id
    AND x.credit_cents=cents AND x.unapplication_id=u.id)
  OR EXISTS(SELECT FROM crest.money_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.allocation_events x WHERE x.business_id=e.business_id AND x.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_JOURNAL_REQUIRED';END IF;
END $verify$;

CREATE OR REPLACE FUNCTION crest_private.verify_fictional_invoice_credit(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; c crest.invoice_credits; i crest.invoice_items; r crest.receivable_items; issued crest.financial_events;
 basis record; component record; journal uuid; receipt jsonb;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT c FROM crest.invoice_credits WHERE business_id=requested_business AND id=e.invoice_credit_id;
 SELECT * INTO STRICT i FROM crest.invoice_items WHERE business_id=requested_business AND id=c.invoice_item_id;
 SELECT * INTO STRICT r FROM crest.receivable_items WHERE business_id=requested_business AND id=c.receivable_id;
 SELECT * INTO STRICT issued FROM crest.financial_events WHERE business_id=requested_business AND invoice_id=i.invoice_id;
 SELECT * INTO component FROM crest_private.fictional_invoice_credit_components(i,c.first_cent,c.last_cent);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_SOURCE_REQUIRED';END IF;
 SELECT * INTO basis FROM crest_private.fictional_invoice_credit_basis(i,issued,r,e.effective_on,component.tax_cents,component.discount_cents);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_BASIS_REQUIRED';END IF;
 receipt:=crest_private.fictional_invoice_credit_receipt(c,e,r);
 IF e.template<>'P07' OR e.event_sequence NOT IN(1,2) OR issued.template<>'P01' OR e.effective_on<issued.effective_on OR e.posted_at<c.created_at
  OR e.effective_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR (c.net_cents,c.tax_cents,c.discount_cents) IS DISTINCT FROM (component.net_cents,component.tax_cents,component.discount_cents)
  OR (c.returns_mapping_id,c.returns_account_id,c.tax_account_id,c.original_tax_movement_id,c.discount_mapping_id,c.discount_account_id)
   IS DISTINCT FROM (basis.returns_mapping_id,basis.returns_account_id,basis.tax_account_id,basis.original_tax_movement_id,basis.discount_mapping_id,basis.discount_account_id)
  OR NOT crest_private.receivable_has_nonnegative_history(r.business_id,r.id,r.original_cents)
  OR NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
   JOIN crest.atomic_finance_groups prior ON prior.business_id=issued.business_id AND prior.id=issued.group_id
   JOIN crest_private.operations o ON o.business_id=g.business_id AND o.operation_id=g.operation_id AND o.actor_id=g.created_by
   JOIN crest_private.audit_events audit ON audit.business_id=o.business_id AND audit.operation_id=o.operation_id AND audit.actor_id=o.actor_id
   JOIN crest.accounting_periods p ON p.business_id=e.business_id AND p.id=e.period_id
   WHERE g.business_id=e.business_id AND g.id=e.group_id AND g.operation_id=c.operation_id AND g.created_by=c.created_by
    AND g.commit_sequence>prior.commit_sequence AND g.recovery_epoch=o.recovery_epoch
    AND o.state='committed' AND (
      (e.event_sequence=1 AND o.command_type='finance.invoice.credit' AND o.result=receipt) OR
      (e.event_sequence=2 AND o.command_type='finance.invoice.credit_paired' AND o.result->'credit'=receipt
       AND EXISTS(SELECT FROM crest.paired_invoice_credit_releases link
        WHERE link.business_id=c.business_id AND link.invoice_credit_id=c.id AND link.operation_id=c.operation_id)))
    AND audit.entity_kind='invoice_credits' AND audit.entity_id=c.id AND audit.entity_version=1 AND audit.action='credit'
    AND audit.reason=c.reason AND audit.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
    AND e.time_zone=p.time_zone AND e.effective_on BETWEEN p.starts_on AND p.through_on AND e.period_generation%2=0
    AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
     WHERE h.business_id=p.business_id AND h.period_id=p.id),0)
    AND c.first_cent::numeric=1+coalesce((SELECT sum(earlier.inclusive_cents::numeric) FROM crest.invoice_credits earlier
     JOIN crest.financial_events previous ON previous.business_id=earlier.business_id AND previous.invoice_credit_id=earlier.id
     JOIN crest.atomic_finance_groups previous_group ON previous_group.business_id=previous.business_id AND previous_group.id=previous.group_id
     WHERE earlier.business_id=c.business_id AND earlier.invoice_item_id=c.invoice_item_id AND previous_group.commit_sequence<g.commit_sequence),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_SOURCE_REQUIRED';END IF;
 SELECT id INTO journal FROM crest.journal_entries WHERE business_id=requested_business AND event_id=e.id AND entry_sequence=1;
 IF journal IS NULL OR (SELECT count(*) FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id)<>1
  OR (SELECT count(*) FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal)
    <>1+(c.returns_cents>0)::int+(c.tax_cents>0)::int+(c.discount_cents>0)::int
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
   AND x.purpose='credit_ar' AND x.receivable_id=r.id AND x.account_id=r.account_id AND x.credit_cents=c.inclusive_cents AND x.invoice_credit_id=c.id)
  OR (c.returns_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
   AND x.purpose='credit_returns' AND x.account_id=c.returns_account_id AND x.fixed_mapping_id=c.returns_mapping_id
   AND x.debit_cents=c.returns_cents AND x.invoice_credit_id=c.id))
  OR (c.tax_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
   AND x.purpose='credit_tax' AND x.account_id=c.tax_account_id AND x.debit_cents=c.tax_cents AND x.invoice_credit_id=c.id))
  OR (c.discount_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
   AND x.purpose='credit_discount' AND x.account_id=c.discount_account_id AND x.fixed_mapping_id=c.discount_mapping_id
   AND x.credit_cents=c.discount_cents AND x.invoice_credit_id=c.id))
  OR EXISTS(SELECT FROM crest.money_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.allocation_events x WHERE x.business_id=e.business_id AND x.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_JOURNAL_REQUIRED';END IF;
END $verify$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.credit_fictional_paid_invoice_line(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_credit uuid,requested_item uuid,requested_customer uuid,
 reviewed_on date,requested_first_cent bigint,requested_last_cent bigint,expected_returns_mapping uuid,requested_unapplication uuid,
 requested_allocation uuid,release_first_cent bigint,release_last_cent bigint,expected_funds_mapping uuid,
 expected_ar_cents bigint,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; saved record; i crest.invoice_items; r crest.receivable_items; issued crest.financial_events;
 c crest.invoice_credits; e crest.financial_events; basis record; component record; period record;
 claimed uuid; group_id uuid; journal_id uuid; outstanding numeric; dated_ar numeric; next_offset numeric; receipt jsonb;
 a crest.allocation_events; original_payment crest.financial_events; parent crest.funding_partitions; root crest.funding_origins;
 u crest.allocation_unapplications; l crest.customer_fund_lots; released crest.financial_events; m crest.account_mapping_versions;
 release_cents bigint; release_receipt jsonb; credit_receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_credit IS NULL OR requested_item IS NULL OR requested_customer IS NULL
  OR reviewed_on IS NULL OR reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31'
  OR requested_first_cent IS NULL OR requested_last_cent IS NULL OR requested_first_cent<1 OR requested_last_cent<requested_first_cent
  OR expected_returns_mapping IS NULL OR requested_unapplication IS NULL OR requested_allocation IS NULL
  OR release_first_cent IS NULL OR release_last_cent IS NULL OR release_first_cent<1 OR release_last_cent<release_first_cent
  OR expected_funds_mapping IS NULL OR expected_ar_cents IS NULL OR expected_ar_cents<0 OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.invoice.credit_paired',1,requested_business,expected_actor,expected_epoch,
  requested_credit,requested_item,requested_customer,reviewed_on,requested_first_cent::text,requested_last_cent::text,
  expected_returns_mapping,requested_unapplication,requested_allocation,release_first_cent::text,release_last_cent::text,
  expected_funds_mapping,expected_ar_cents::text,review_reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.invoice.credit_paired',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.invoice.credit_paired' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT item.* INTO i FROM crest.invoice_items item JOIN crest.invoices original
  ON original.business_id=item.business_id AND original.id=item.invoice_id
 WHERE item.business_id=requested_business AND item.id=requested_item AND original.customer_id=requested_customer;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_ITEM_REQUIRED';END IF;
 IF i.total_cents=0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_ZERO_COMPONENT_REVIEW_REQUIRED';END IF;
 SELECT * INTO STRICT r FROM crest.receivable_items WHERE business_id=requested_business AND invoice_id=i.invoice_id AND customer_id=requested_customer;
 SELECT * INTO STRICT issued FROM crest.financial_events WHERE business_id=requested_business AND invoice_id=i.invoice_id;
 IF reviewed_on<issued.effective_on OR reviewed_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_DATE_REQUIRED';
 END IF;
 SELECT coalesce(max(previous.last_cent),0)::numeric+1 INTO next_offset FROM crest.invoice_credits previous
  WHERE previous.business_id=requested_business AND previous.invoice_item_id=i.id;
 IF requested_first_cent<>next_offset OR requested_last_cent>i.total_cents THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_RANGE_UNAVAILABLE';
 END IF;
 IF EXISTS(SELECT FROM crest.invoice_credits x WHERE x.business_id=requested_business AND x.id=requested_credit) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='INVOICE_CREDIT_ALREADY_RECORDED';
 END IF;
 SELECT min(remaining) INTO outstanding FROM (
  SELECT r.original_cents+coalesce(sum(d.signed_cents) FILTER(WHERE d.effective_on<=reviewed_on),0) AS remaining
  FROM crest_private.receivable_posted_deltas(requested_business,r.id) d
  UNION ALL
  SELECT r.original_cents+dated.running FROM (
   SELECT d.effective_on,sum(d.signed_cents) OVER(ORDER BY d.effective_on,d.commit_sequence,d.event_sequence) AS running
   FROM crest_private.receivable_posted_deltas(requested_business,r.id) d
  ) dated WHERE dated.effective_on>reviewed_on
 ) capacity;
 SELECT r.original_cents+coalesce(sum(d.signed_cents),0) INTO dated_ar
 FROM crest_private.receivable_posted_deltas(requested_business,r.id) d WHERE d.effective_on<=reviewed_on;
 release_cents:=release_last_cent-release_first_cent+1;
 IF dated_ar<>expected_ar_cents THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_BALANCE_CHANGED';END IF;
 IF release_cents::numeric<>requested_last_cent::numeric-requested_first_cent+1-dated_ar THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_EXACT_RELEASE_REQUIRED';
 END IF;
 IF outstanding<dated_ar THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_CHRONOLOGY_REQUIRED';
 END IF;
 SELECT * INTO a FROM crest.allocation_events WHERE business_id=requested_business AND id=requested_allocation AND receivable_id=r.id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_ALLOCATION_REQUIRED';END IF;
 SELECT * INTO STRICT original_payment FROM crest.financial_events WHERE business_id=requested_business AND id=a.event_id;
 SELECT * INTO STRICT parent FROM crest.funding_partitions WHERE business_id=requested_business AND id=a.partition_id;
 SELECT * INTO STRICT root FROM crest.funding_origins WHERE business_id=requested_business AND id=parent.origin_id;
 IF original_payment.template<>'P03' OR root.customer_id<>r.customer_id OR original_payment.effective_on>reviewed_on THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_ALLOCATION_REQUIRED';
 END IF;
 IF release_first_cent<parent.first_cent OR release_last_cent>parent.last_cent OR EXISTS(
  SELECT FROM crest.allocation_unapplications taken WHERE taken.business_id=requested_business AND taken.allocation_id=a.id
   AND taken.first_cent<=release_last_cent AND taken.last_cent>=release_first_cent) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_RELEASE_UNAVAILABLE';
 END IF;
 IF EXISTS(SELECT FROM crest.allocation_unapplications x WHERE x.business_id=requested_business AND x.id=requested_unapplication) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PAIRED_INVOICE_CREDIT_RELEASE_ALREADY_RECORDED';
 END IF;
 SELECT * INTO m FROM crest.account_mapping_versions v WHERE v.business_id=requested_business AND v.id=expected_funds_mapping
  AND v.id=crest_private.unapplication_funds_mapping(requested_business,reviewed_on);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_FUNDS_MAPPING_REQUIRED';END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,reviewed_on,auth->>'timezone');
 SELECT * INTO STRICT component FROM crest_private.fictional_invoice_credit_components(i,requested_first_cent,requested_last_cent);
 SELECT * INTO basis FROM crest_private.fictional_invoice_credit_basis(i,issued,r,reviewed_on,component.tax_cents,component.discount_cents);
 IF NOT FOUND OR basis.returns_mapping_id IS DISTINCT FROM expected_returns_mapping THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_BASIS_REQUIRED';
 END IF;
 INSERT INTO crest.invoice_credits(id,business_id,invoice_item_id,receivable_id,first_cent,last_cent,net_cents,tax_cents,discount_cents,
  returns_mapping_id,returns_account_id,tax_account_id,original_tax_movement_id,discount_mapping_id,discount_account_id,reason,operation_id,created_by)
 VALUES(requested_credit,requested_business,i.id,r.id,requested_first_cent,requested_last_cent,component.net_cents,component.tax_cents,component.discount_cents,
  basis.returns_mapping_id,basis.returns_account_id,basis.tax_account_id,basis.original_tax_movement_id,basis.discount_mapping_id,basis.discount_account_id,
  review_reason,requested_operation,expected_actor) RETURNING * INTO c;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.allocation_unapplications(id,business_id,allocation_id,first_cent,last_cent,reason,operation_id,created_by)
 VALUES(requested_unapplication,requested_business,a.id,release_first_cent,release_last_cent,review_reason,requested_operation,expected_actor)
 RETURNING * INTO u;
 INSERT INTO crest.customer_fund_lots(business_id,unapplication_id,origin_id,parent_partition_id,customer_id,account_id,mapping_id,original_cents)
 VALUES(requested_business,u.id,root.id,parent.id,r.customer_id,m.account_id,m.id,release_cents) RETURNING * INTO l;
 INSERT INTO crest.paired_invoice_credit_releases(business_id,invoice_credit_id,unapplication_id,operation_id,actor_id,reviewed_ar_cents)
 VALUES(requested_business,c.id,u.id,requested_operation,expected_actor,expected_ar_cents);
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,unapplication_id,period_id,period_generation,effective_on,time_zone,
  template,template_version)
 VALUES(requested_business,group_id,1,u.id,period.period_id,period.generation,reviewed_on,auth->>'timezone','P05',1) RETURNING * INTO released;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,released.id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,unapplication_id,receivable_id,account_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,u.id,r.id,r.account_id,'unapply_ar',release_cents,0);
 INSERT INTO crest.journal_lines(business_id,entry_id,unapplication_id,fund_lot_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,u.id,l.id,l.account_id,l.mapping_id,'unapply_funds',0,release_cents);

 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,invoice_credit_id,period_id,period_generation,effective_on,time_zone,
  template,template_version)
 VALUES(requested_business,group_id,2,c.id,period.period_id,period.generation,reviewed_on,auth->>'timezone','P07',1) RETURNING * INTO e;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,e.id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,invoice_credit_id,receivable_id,account_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,c.id,r.id,r.account_id,'credit_ar',0,c.inclusive_cents);
 IF c.returns_cents>0 THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,invoice_credit_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,c.id,c.returns_account_id,c.returns_mapping_id,'credit_returns',c.returns_cents,0);
 END IF;
 IF c.tax_cents>0 THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,invoice_credit_id,account_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,c.id,c.tax_account_id,'credit_tax',c.tax_cents,0);
 END IF;
 IF c.discount_cents>0 THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,invoice_credit_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,c.id,c.discount_account_id,c.discount_mapping_id,'credit_discount',0,c.discount_cents);
 END IF;

 credit_receipt:=crest_private.fictional_invoice_credit_receipt(c,e,r);
 release_receipt:=crest_private.fictional_unapplication_receipt(u,l,released,r);
 receipt:=jsonb_build_object('schemaVersion',1,'credit',credit_receipt,'release',release_receipt);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES
 (requested_business,requested_operation,expected_actor,expected_actor,'invoice_credits',c.id,1,'credit',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',credit_receipt),'manual'),
 (requested_business,requested_operation,expected_actor,expected_actor,'allocation_unapplications',u.id,1,'unapply',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',release_receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.credit_fictional_paid_invoice_line(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,uuid,uuid,uuid,bigint,bigint,uuid,bigint,text) OWNER TO crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.credit_fictional_paid_invoice_line(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,uuid,uuid,uuid,bigint,bigint,uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.credit_fictional_paid_invoice_line(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,uuid,uuid,uuid,bigint,bigint,uuid,bigint,text) TO crest_finance_preview;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY paired_credit_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='allocation_unapplications' AND action='unapply' AND entity_version=1
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.invoice.credit_paired' AND o.state='committed'));

CREATE FUNCTION crest_commands.lookup_fictional_paired_invoice_credit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_credit uuid,original_unapplication uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; c crest.invoice_credits; u crest.allocation_unapplications; l crest.customer_fund_lots;
 r crest.receivable_items; credit_event crest.financial_events; release_event crest.financial_events; credit jsonb; release jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_credit IS NULL OR original_unapplication IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT o.recovery_epoch,o.result,p.invoice_credit_id,p.unapplication_id INTO saved
 FROM crest_private.operations o JOIN crest.paired_invoice_credit_releases p
  ON p.business_id=o.business_id AND p.operation_id=o.operation_id AND p.actor_id=o.actor_id
 WHERE o.business_id=requested_business AND o.operation_id=original_operation AND o.actor_id=expected_actor
  AND o.command_type='finance.invoice.credit_paired' AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF (saved.recovery_epoch,saved.invoice_credit_id,saved.unapplication_id) IS DISTINCT FROM (original_epoch,original_credit,original_unapplication) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT c FROM crest.invoice_credits WHERE business_id=requested_business AND id=original_credit;
 SELECT * INTO STRICT u FROM crest.allocation_unapplications WHERE business_id=requested_business AND id=original_unapplication;
 SELECT * INTO STRICT r FROM crest.receivable_items WHERE business_id=requested_business AND id=c.receivable_id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND unapplication_id=u.id;
 SELECT * INTO STRICT credit_event FROM crest.financial_events WHERE business_id=requested_business AND invoice_credit_id=c.id;
 SELECT * INTO STRICT release_event FROM crest.financial_events WHERE business_id=requested_business AND unapplication_id=u.id;
 credit:=crest_private.fictional_invoice_credit_receipt(c,credit_event,r);
 release:=crest_private.fictional_unapplication_receipt(u,l,release_event,r);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'credit',credit,'release',release)
  OR NOT EXISTS(SELECT FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.operation_id=original_operation
   AND a.actor_id=expected_actor AND a.entity_kind='invoice_credits' AND a.entity_id=c.id AND a.action='credit' AND a.reason=c.reason
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',credit))
  OR NOT EXISTS(SELECT FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.operation_id=original_operation
   AND a.actor_id=expected_actor AND a.entity_kind='allocation_unapplications' AND a.entity_id=u.id AND a.action='unapply' AND a.reason=u.reason
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',release))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_paired_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_paired_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_paired_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid)
 TO crest_finance_preview;

-- Until the paired portable profile is introduced, the original P05/P07
-- profile refuses this business instead of omitting or mislabeling rows.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(business_id) ON crest.paired_invoice_credit_releases TO crest_unapplication_export_owner,crest_invoice_credit_export_owner;
CREATE POLICY paired_credit_export_fence ON crest.paired_invoice_credit_releases FOR SELECT
 TO crest_unapplication_export_owner,crest_invoice_credit_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_private.require_unpaired_credit_export_scope(requested_business uuid)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $scope$
BEGIN
 IF EXISTS(SELECT FROM crest.paired_invoice_credit_releases p WHERE p.business_id=requested_business) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_REVIEW_REQUIRED';
 END IF;
END $scope$;
REVOKE ALL ON FUNCTION crest_private.require_unpaired_credit_export_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.require_unpaired_credit_export_scope(uuid)
 TO crest_unapplication_export_owner,crest_invoice_credit_export_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_unapplication_export_owner;
SET LOCAL ROLE crest_unapplication_export_owner;
CREATE OR REPLACE FUNCTION crest_commands.unapplication_source_snapshot_context(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.unapplication_source_token(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_private.require_unpaired_credit_export_scope(requested_business);
 FOR source IN SELECT * FROM crest_private.unapplication_source_dictionary() LOOP
  PERFORM crest_private.unapplication_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_UNAPPLICATION_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'scope','allocation_unapplication_sources','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE OR REPLACE FUNCTION crest_commands.unapplication_source_snapshot_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.unapplication_source_token(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNAPPLICATION_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.unapplication_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNAPPLICATION_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.unapplication_source_check_group(requested_group,fields);
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_private.require_unpaired_credit_export_scope(requested_business);

 SELECT string_agg(format('%L,%s',name,CASE kind
  WHEN 'timestamp with time zone' THEN
   format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
  ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS spec(name,kind);

 EXECUTE format($query$
  WITH candidates AS MATERIALIZED (
   SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
   WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3+1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',$1,'snapshotToken',$4,'group',$5,
   'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
   'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_UNAPPLICATION_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_unapplication_export_owner;

GRANT CREATE ON SCHEMA crest_commands TO crest_invoice_credit_export_owner;
SET LOCAL ROLE crest_invoice_credit_export_owner;
CREATE OR REPLACE FUNCTION crest_commands.invoice_credit_source_snapshot_context(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.invoice_credit_source_token(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_private.require_unpaired_credit_export_scope(requested_business);
 FOR source IN SELECT * FROM crest_private.invoice_credit_source_dictionary() LOOP
  PERFORM crest_private.invoice_credit_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'scope','invoice_credit_sources','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE OR REPLACE FUNCTION crest_commands.invoice_credit_source_snapshot_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.invoice_credit_source_token(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.invoice_credit_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.invoice_credit_source_check_group(requested_group,fields);
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_private.require_unpaired_credit_export_scope(requested_business);

 SELECT string_agg(format('%L,%s',name,CASE kind
  WHEN 'timestamp with time zone' THEN
   format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
  ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS spec(name,kind);

 EXECUTE format($query$
  WITH candidates AS MATERIALIZED (
   SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
   WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3+1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',$1,'snapshotToken',$4,'group',$5,
   'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
   'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_invoice_credit_export_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-credit-paired.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-credit-paired-operations.sql
-- Held E08 single-release paired review and explicit absent retirement.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY paired_credit_retirement_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_paired_credit');
CREATE POLICY paired_credit_retirement_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_paired_credit'
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY paired_credit_retirement_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_paired_credit' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_paired_credit' AND state='committed');
CREATE POLICY paired_credit_retirement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire'
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.invoice.retire_paired_credit' AND o.state='committed'));
CREATE POLICY paired_credit_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.invoice.retire_paired_credit' AND o.state='pending'));


CREATE FUNCTION crest_commands.retire_fictional_paired_invoice_credit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_credit uuid,original_unapplication uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR
  review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_paired_invoice_credit($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12,$13);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'invoiceCreditId',original_credit,'unapplicationId',original_unapplication,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.invoice.retire_paired_credit',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_paired_invoice_credit($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12,$13);
  IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,original_operation,expected_actor,expected_actor,'operations',claim,1,'retire',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=original_operation;
 PERFORM crest_commands.finish_financial_retirement_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,original_operation);
 RETURN jsonb_build_object('state','retired','receipt',receipt);
END $retire$;

CREATE FUNCTION crest_commands.read_fictional_paired_invoice_credit_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_invoice uuid,requested_allocation uuid,reviewed_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE credit jsonb; release jsonb; selected date; r crest.receivable_items; dated_ar numeric; returns_mapping uuid;
BEGIN
 IF requested_customer IS NULL OR requested_invoice IS NULL OR requested_allocation IS NULL
  OR (reviewed_on IS NOT NULL AND (reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 credit:=crest_commands.read_fictional_invoice_credit_options($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12);
 IF credit->>'state'='absent' OR credit->>'receivableId' IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 selected:=(credit->>'effectiveOn')::date;
 SELECT r0.* INTO STRICT r FROM crest.receivable_items r0
 WHERE r0.business_id=requested_business AND r0.invoice_id=requested_invoice AND r0.customer_id=requested_customer;
 -- Check the selected allocation against the invoice before reading its date
 -- or details, including when both invoices belong to the same customer.
 IF NOT EXISTS(SELECT FROM crest.allocation_events a WHERE a.business_id=requested_business
  AND a.id=requested_allocation AND a.receivable_id=r.id) THEN RETURN jsonb_build_object('state','absent');END IF;
 release:=crest_commands.read_fictional_allocation_unapplication_options($1,$2,$3,$4,$5,$6,$7,$8,$9,$11,selected);
 IF release->>'state'='absent' THEN RETURN jsonb_build_object('state','absent');END IF;
 IF release->>'receivableId' IS DISTINCT FROM credit->>'receivableId'
  OR release->>'effectiveOn' IS DISTINCT FROM credit->>'effectiveOn'
  OR release->'openPeriod' IS DISTINCT FROM credit->'openPeriod' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_REVIEW_REQUIRED';
 END IF;
 SELECT r.original_cents+coalesce(sum(d.signed_cents),0) INTO dated_ar
 FROM crest_private.receivable_posted_deltas(r.business_id,r.id) d WHERE d.effective_on<=selected;
 -- A fully settled invoice has no standalone credit capacity. Its paired
 -- review still needs the active returns mapping before any release is chosen.
 SELECT basis.returns_mapping_id INTO returns_mapping
 FROM crest.invoice_items i JOIN crest.financial_events e ON e.business_id=i.business_id AND e.invoice_id=i.invoice_id
 CROSS JOIN LATERAL crest_private.fictional_invoice_credit_basis(i,e,r,selected,0,0) basis
 WHERE i.business_id=requested_business AND i.invoice_id=requested_invoice AND i.total_cents>0
 ORDER BY i.position LIMIT 1;
 RETURN jsonb_build_object('state','review','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'invoiceId',requested_invoice,'allocationId',requested_allocation,'credit',credit,'release',release,
  'reviewedArCents',dated_ar::text,'returnsMappingId',returns_mapping,
  'chronologySupported',dated_ar=(credit->>'availableBalanceCents')::numeric);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_paired_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_paired_invoice_credit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,date) OWNER TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE OR REPLACE FUNCTION crest_commands.lookup_fictional_paired_invoice_credit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_credit uuid,original_unapplication uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; retirement_audit jsonb; c crest.invoice_credits; u crest.allocation_unapplications; l crest.customer_fund_lots;
 r crest.receivable_items; credit_event crest.financial_events; release_event crest.financial_events; credit jsonb; release jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_credit IS NULL OR original_unapplication IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT o.id,o.recovery_epoch,o.result,o.command_type,o.payload_hash,p.invoice_credit_id,p.unapplication_id INTO saved
 FROM crest_private.operations o LEFT JOIN crest.paired_invoice_credit_releases p
  ON p.business_id=o.business_id AND p.operation_id=o.operation_id AND p.actor_id=o.actor_id
 WHERE o.business_id=requested_business AND o.operation_id=original_operation AND o.actor_id=expected_actor
  AND o.command_type IN('finance.invoice.credit_paired','finance.invoice.retire_paired_credit') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.command_type='finance.invoice.retire_paired_credit' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'invoiceCreditId',saved.result->>'unapplicationId')
   IS DISTINCT FROM (original_epoch::text,original_credit::text,original_unapplication::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.delta INTO retirement_audit FROM crest_private.audit_events a
  WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
   AND a.entity_kind='operations' AND a.entity_id=saved.id AND a.action='retire' AND a.entity_version=1 AND a.reason=saved.result->>'reason';
  IF saved.invoice_credit_id IS NOT NULL OR saved.unapplication_id IS NOT NULL OR saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR retirement_audit IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_RETIREMENT_AUDIT_REQUIRED';END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF saved.invoice_credit_id IS NULL OR saved.unapplication_id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_SOURCE_REQUIRED';
 END IF;
 IF (saved.recovery_epoch,saved.invoice_credit_id,saved.unapplication_id) IS DISTINCT FROM (original_epoch,original_credit,original_unapplication) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT c FROM crest.invoice_credits WHERE business_id=requested_business AND id=original_credit;
 SELECT * INTO STRICT u FROM crest.allocation_unapplications WHERE business_id=requested_business AND id=original_unapplication;
 SELECT * INTO STRICT r FROM crest.receivable_items WHERE business_id=requested_business AND id=c.receivable_id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND unapplication_id=u.id;
 SELECT * INTO STRICT credit_event FROM crest.financial_events WHERE business_id=requested_business AND invoice_credit_id=c.id;
 SELECT * INTO STRICT release_event FROM crest.financial_events WHERE business_id=requested_business AND unapplication_id=u.id;
 credit:=crest_private.fictional_invoice_credit_receipt(c,credit_event,r);
 release:=crest_private.fictional_unapplication_receipt(u,l,release_event,r);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'credit',credit,'release',release)
  OR NOT EXISTS(SELECT FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.operation_id=original_operation
   AND a.actor_id=expected_actor AND a.entity_kind='invoice_credits' AND a.entity_id=c.id AND a.action='credit' AND a.reason=c.reason
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',credit))
  OR NOT EXISTS(SELECT FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.operation_id=original_operation
   AND a.actor_id=expected_actor AND a.entity_kind='allocation_unapplications' AND a.entity_id=u.id AND a.action='unapply' AND a.reason=u.reason
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',release))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_paired_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_paired_invoice_credit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_paired_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_paired_invoice_credit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,date) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-credit-paired-operations.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-credit-paired-source.sql
-- Held E08 paired link and versioned exact P05/P07 snapshot readers.
DO $review$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='crest_paired_credit_export_owner') OR
  NOT EXISTS(SELECT FROM pg_roles WHERE rolname='crest_export'
   AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('crest_commands.business_history_export_context(uuid)')
   AND proowner='crest_export_owner'::regrole AND prosecdef)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_AUTHORITY_REVIEW_REQUIRED';END IF;
END $review$;
CREATE ROLE crest_paired_credit_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_paired_credit_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_commands,crest_private TO crest_paired_credit_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid),
 crest_commands.business_configuration_export_context(uuid) TO crest_paired_credit_export_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.paired_invoice_credit_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES ('paired_invoice_credit_releases',ARRAY[
  'id:uuid','business_id:uuid','invoice_credit_id:uuid','unapplication_id:uuid',
  'operation_id:uuid','actor_id:uuid','reviewed_ar_cents:bigint'
 ]);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.paired_invoice_credit_source_dictionary() FROM PUBLIC;

CREATE FUNCTION crest_private.paired_invoice_credit_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
REVOKE ALL ON FUNCTION crest_private.paired_invoice_credit_source_check_group(text,text[]) FROM PUBLIC;

CREATE FUNCTION crest_private.paired_invoice_credit_source_token(requested_business uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $token$
DECLARE snapshot_value text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_SCOPE_REQUIRED';END IF;
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
 RETURN encode(sha256(convert_to(jsonb_build_array('crest.paired.invoice.credit.sources/1',requested_business,
  pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
END $token$;
REVOKE ALL ON FUNCTION crest_private.paired_invoice_credit_source_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.paired_invoice_credit_source_dictionary(),
 crest_private.paired_invoice_credit_source_check_group(text,text[]),crest_private.paired_invoice_credit_source_token(uuid) TO crest_paired_credit_export_owner;

DO $grants$
DECLARE source record; columns text;
BEGIN
 FOR source IN SELECT * FROM crest_private.paired_invoice_credit_source_dictionary() LOOP
  PERFORM crest_private.paired_invoice_credit_source_check_group(source.group_name,source.fields);
  IF has_any_column_privilege('crest_export',format('crest.%I',source.group_name),'SELECT,INSERT,UPDATE,REFERENCES')
   OR has_table_privilege('crest_export',format('crest.%I',source.group_name),'DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_AUTHORITY_REVIEW_REQUIRED';
  END IF;
  SELECT string_agg(format('%I',split_part(field,':',1)),',') INTO columns FROM unnest(source.fields) AS field;
  EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_paired_credit_export_owner',columns,source.group_name);
 END LOOP;
END $grants$;
CREATE POLICY paired_invoice_credit_source_export_read ON crest.paired_invoice_credit_releases FOR SELECT TO crest_paired_credit_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);

CREATE FUNCTION crest_commands.paired_invoice_credit_source_snapshot_context(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.paired_invoice_credit_source_token(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.paired_invoice_credit_source_dictionary() LOOP
  PERFORM crest_private.paired_invoice_credit_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'scope','paired_invoice_credit_sources','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.paired_invoice_credit_source_snapshot_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.paired_invoice_credit_source_token(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.paired_invoice_credit_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.paired_invoice_credit_source_check_group(requested_group,fields);
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);

 SELECT string_agg(format('%L,%s',name,CASE kind
  WHEN 'timestamp with time zone' THEN
   format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
  ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS spec(name,kind);

 EXECUTE format($query$
  WITH candidates AS MATERIALIZED (
   SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
   WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3+1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',$1,'snapshotToken',$4,'group',$5,
   'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
   'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_paired_credit_export_owner;
ALTER FUNCTION crest_commands.paired_invoice_credit_source_snapshot_context(uuid) OWNER TO crest_paired_credit_export_owner;
ALTER FUNCTION crest_commands.paired_invoice_credit_source_snapshot_page(uuid,text,text,uuid,integer) OWNER TO crest_paired_credit_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_paired_credit_export_owner;
REVOKE ALL ON FUNCTION crest_commands.paired_invoice_credit_source_snapshot_context(uuid),
 crest_commands.paired_invoice_credit_source_snapshot_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.paired_invoice_credit_source_snapshot_context(uuid),
 crest_commands.paired_invoice_credit_source_snapshot_page(uuid,text,text,uuid,integer) TO crest_export;


SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.unapplication_source_token_v2(requested_business uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $token$
 SELECT encode(sha256(convert_to('crest.paired.unapplication.source.v2:'||crest_private.unapplication_source_token(requested_business),'UTF8')),'hex');
$token$;
REVOKE ALL ON FUNCTION crest_private.unapplication_source_token_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.unapplication_source_token_v2(uuid) TO crest_unapplication_export_owner;

CREATE FUNCTION crest_commands.unapplication_source_snapshot_context_v2(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.unapplication_source_token_v2(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.unapplication_source_dictionary() LOOP
  PERFORM crest_private.unapplication_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_UNAPPLICATION_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',2,'scope','allocation_unapplication_sources_v2','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.unapplication_source_snapshot_page_v2(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.unapplication_source_token_v2(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNAPPLICATION_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.unapplication_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNAPPLICATION_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.unapplication_source_check_group(requested_group,fields);
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);

 SELECT string_agg(format('%L,%s',name,CASE kind
  WHEN 'timestamp with time zone' THEN
   format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
  ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS spec(name,kind);

 EXECUTE format($query$
  WITH candidates AS MATERIALIZED (
   SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
   WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3+1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
  SELECT jsonb_build_object('schemaVersion',2,'businessId',$1,'snapshotToken',$4,'group',$5,
   'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
   'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_UNAPPLICATION_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_unapplication_export_owner;
ALTER FUNCTION crest_commands.unapplication_source_snapshot_context_v2(uuid) OWNER TO crest_unapplication_export_owner;
ALTER FUNCTION crest_commands.unapplication_source_snapshot_page_v2(uuid,text,text,uuid,integer) OWNER TO crest_unapplication_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_unapplication_export_owner;
REVOKE ALL ON FUNCTION crest_commands.unapplication_source_snapshot_context_v2(uuid),crest_commands.unapplication_source_snapshot_page_v2(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.unapplication_source_snapshot_context_v2(uuid),crest_commands.unapplication_source_snapshot_page_v2(uuid,text,text,uuid,integer) TO crest_export;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.invoice_credit_source_token_v2(requested_business uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $token$
 SELECT encode(sha256(convert_to('crest.paired.invoice_credit.source.v2:'||crest_private.invoice_credit_source_token(requested_business),'UTF8')),'hex');
$token$;
REVOKE ALL ON FUNCTION crest_private.invoice_credit_source_token_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.invoice_credit_source_token_v2(uuid) TO crest_invoice_credit_export_owner;

CREATE FUNCTION crest_commands.invoice_credit_source_snapshot_context_v2(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.invoice_credit_source_token_v2(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.invoice_credit_source_dictionary() LOOP
  PERFORM crest_private.invoice_credit_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',2,'scope','invoice_credit_sources_v2','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.invoice_credit_source_snapshot_page_v2(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.invoice_credit_source_token_v2(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.invoice_credit_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.invoice_credit_source_check_group(requested_group,fields);
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);

 SELECT string_agg(format('%L,%s',name,CASE kind
  WHEN 'timestamp with time zone' THEN
   format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
  ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS spec(name,kind);

 EXECUTE format($query$
  WITH candidates AS MATERIALIZED (
   SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
   WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3+1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
  SELECT jsonb_build_object('schemaVersion',2,'businessId',$1,'snapshotToken',$4,'group',$5,
   'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
   'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_invoice_credit_export_owner;
ALTER FUNCTION crest_commands.invoice_credit_source_snapshot_context_v2(uuid) OWNER TO crest_invoice_credit_export_owner;
ALTER FUNCTION crest_commands.invoice_credit_source_snapshot_page_v2(uuid,text,text,uuid,integer) OWNER TO crest_invoice_credit_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_invoice_credit_export_owner;
REVOKE ALL ON FUNCTION crest_commands.invoice_credit_source_snapshot_context_v2(uuid),crest_commands.invoice_credit_source_snapshot_page_v2(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.invoice_credit_source_snapshot_context_v2(uuid),crest_commands.invoice_credit_source_snapshot_page_v2(uuid,text,text,uuid,integer) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-credit-paired-source.sql
