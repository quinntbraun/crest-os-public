-- P01/P02 posting records. Only restricted source commands will receive write
-- access. These constraints validate source effects again at commit.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.atomic_finance_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 commit_sequence bigint NOT NULL CHECK(commit_sequence>0),
 recovery_epoch uuid NOT NULL,
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,commit_sequence),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.financial_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 group_id uuid NOT NULL,
 event_sequence integer NOT NULL CHECK(event_sequence>0),
 invoice_id uuid NOT NULL,
 period_id uuid NOT NULL,
 period_generation bigint NOT NULL CHECK(period_generation>=0 AND period_generation%2=0),
 reopened_generation bigint GENERATED ALWAYS AS (nullif(period_generation,0)) STORED,
 effective_on date NOT NULL,
 time_zone text NOT NULL,
 template text NOT NULL CHECK(template IN('P01','P02')),
 template_version integer NOT NULL CHECK(template_version=1),
 zero_effect_reason text CHECK(zero_effect_reason='literal_zero_charge'),
 posted_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(posted_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,group_id,event_sequence),
 UNIQUE(business_id,invoice_id),
 FOREIGN KEY(business_id,group_id) REFERENCES crest.atomic_finance_groups(business_id,id),
 FOREIGN KEY(business_id,invoice_id) REFERENCES crest.invoices(business_id,id),
 FOREIGN KEY(business_id,period_id) REFERENCES crest.accounting_periods(business_id,id),
 FOREIGN KEY(business_id,period_id,reopened_generation) REFERENCES crest.accounting_period_locks(business_id,period_id,generation)
);
CREATE INDEX invoice_event_period ON crest.financial_events(business_id,period_id,reopened_generation);

CREATE TABLE crest.receivable_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 account_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 original_cents bigint NOT NULL CHECK(original_cents>0),
 due_on date NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,invoice_id),
 FOREIGN KEY(business_id,invoice_id) REFERENCES crest.invoices(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id)
);
CREATE INDEX receivable_account ON crest.receivable_items(business_id,account_id);
CREATE INDEX receivable_customer ON crest.receivable_items(business_id,customer_id,due_on,id);

CREATE TABLE crest.invoice_tax_payable_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 event_id uuid NOT NULL,
 invoice_item_id uuid NOT NULL,
 tax_profile_id uuid NOT NULL,
 mapping_id uuid NOT NULL,
 account_id uuid NOT NULL,
 jurisdiction text NOT NULL,
 cents bigint NOT NULL CHECK(cents>0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,invoice_item_id),
 FOREIGN KEY(business_id,event_id) REFERENCES crest.financial_events(business_id,id),
 FOREIGN KEY(business_id,invoice_item_id) REFERENCES crest.invoice_items(business_id,id),
 FOREIGN KEY(business_id,tax_profile_id) REFERENCES crest.tax_profiles(business_id,id),
 FOREIGN KEY(business_id,mapping_id) REFERENCES crest.tax_payable_mapping_versions(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id)
);
CREATE INDEX invoice_tax_payable_event ON crest.invoice_tax_payable_movements(business_id,event_id);
CREATE INDEX invoice_tax_payable_profile ON crest.invoice_tax_payable_movements(business_id,tax_profile_id);
CREATE INDEX invoice_tax_payable_mapping ON crest.invoice_tax_payable_movements(business_id,mapping_id);
CREATE INDEX invoice_tax_payable_account ON crest.invoice_tax_payable_movements(business_id,account_id);
CREATE INDEX invoice_tax_payable_jurisdiction ON crest.invoice_tax_payable_movements(business_id,jurisdiction);

CREATE TABLE crest.journal_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 event_id uuid NOT NULL,
 entry_sequence integer NOT NULL CHECK(entry_sequence>0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,event_id,entry_sequence),
 FOREIGN KEY(business_id,event_id) REFERENCES crest.financial_events(business_id,id)
);
CREATE TABLE crest.journal_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 entry_id uuid NOT NULL,
 invoice_item_id uuid NOT NULL,
 receivable_id uuid,
 account_id uuid NOT NULL,
 fixed_mapping_id uuid,
 tax_payable_movement_id uuid,
 purpose text NOT NULL CHECK(purpose IN('ar','discount','service_revenue','tax_payable')),
 debit_cents bigint NOT NULL CHECK(debit_cents>=0),
 credit_cents bigint NOT NULL CHECK(credit_cents>=0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,entry_id,invoice_item_id,purpose),
 FOREIGN KEY(business_id,entry_id) REFERENCES crest.journal_entries(business_id,id),
 FOREIGN KEY(business_id,invoice_item_id) REFERENCES crest.invoice_items(business_id,id),
 FOREIGN KEY(business_id,receivable_id) REFERENCES crest.receivable_items(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,fixed_mapping_id) REFERENCES crest.account_mapping_versions(business_id,id),
 FOREIGN KEY(business_id,tax_payable_movement_id) REFERENCES crest.invoice_tax_payable_movements(business_id,id),
 CHECK((debit_cents>0)<>(credit_cents>0)),
 CHECK((purpose='ar')=(receivable_id IS NOT NULL)),
 CHECK((purpose='tax_payable')=(tax_payable_movement_id IS NOT NULL)),
 CHECK((purpose='tax_payable')=(fixed_mapping_id IS NULL))
);
CREATE INDEX invoice_journal_line_item ON crest.journal_lines(business_id,invoice_item_id);
CREATE INDEX invoice_journal_line_account ON crest.journal_lines(business_id,account_id);
CREATE INDEX invoice_journal_line_mapping ON crest.journal_lines(business_id,fixed_mapping_id);
CREATE INDEX invoice_journal_line_receivable ON crest.journal_lines(business_id,receivable_id);
CREATE INDEX invoice_journal_line_tax_movement ON crest.journal_lines(business_id,tax_payable_movement_id);

DO $ledger$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['atomic_finance_groups','financial_events','receivable_items','invoice_tax_payable_movements','journal_entries','journal_lines'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('GRANT SELECT ON crest.%I TO crest_finance_integrity_owner',name);
  EXECUTE format('CREATE POLICY finance_ledger_integrity ON crest.%I FOR SELECT TO crest_finance_integrity_owner USING(true)',name);
  EXECUTE format('CREATE TRIGGER finance_ledger_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I
    FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',name);
 END LOOP;
END $ledger$;
GRANT SELECT ON crest.accounting_period_locks TO crest_finance_integrity_owner;
CREATE POLICY invoice_ledger_period_lock_integrity ON crest.accounting_period_locks FOR SELECT TO crest_finance_integrity_owner USING(true);
GRANT SELECT(recovery_epoch) ON crest_private.operations TO crest_finance_integrity_owner;

CREATE FUNCTION crest_private.verify_invoice_posting(business uuid, invoice uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE issued crest.invoices; event crest.financial_events; entry crest.journal_entries; ar crest.receivable_items;
 expected_count bigint; actual_count bigint; debits numeric; credits numeric; expected_zero boolean;
BEGIN
 SELECT i.* INTO STRICT issued FROM crest.invoices i WHERE (i.business_id,i.id)=(business,invoice);
 SELECT e.* INTO event FROM crest.financial_events e WHERE (e.business_id,e.invoice_id)=(business,invoice);
 IF NOT FOUND OR NOT EXISTS(
  SELECT FROM crest.atomic_finance_groups g
  JOIN crest_private.operations o ON (o.business_id,o.operation_id,o.actor_id)=(g.business_id,g.operation_id,g.created_by)
  JOIN crest.accounting_periods p ON (p.business_id,p.id)=(event.business_id,event.period_id)
  WHERE (g.business_id,g.id,g.operation_id,g.created_by,g.recovery_epoch)=
   (business,event.group_id,issued.operation_id,issued.created_by,o.recovery_epoch)
   AND event.event_sequence=1 AND event.effective_on=issued.issued_on AND event.time_zone=issued.time_zone
   AND event.template=CASE WHEN issued.total_cents=0 THEN 'P02' ELSE 'P01' END
   AND event.posted_at>=issued.created_at
   AND (event.posted_at AT TIME ZONE event.time_zone)::date=issued.issued_on
   AND event.time_zone=p.time_zone AND event.effective_on BETWEEN p.starts_on AND p.through_on
   AND event.period_generation=coalesce((SELECT max(l.generation) FROM crest.accounting_period_locks l
    WHERE (l.business_id,l.period_id)=(p.business_id,p.id)),0)
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_POSTING_EVENT_REQUIRED';
 END IF;
 SELECT r.* INTO ar FROM crest.receivable_items r WHERE (r.business_id,r.invoice_id)=(business,invoice);
 IF (ar.id IS NULL)<>(issued.total_cents=0) OR ar.id IS NOT NULL
  AND (ar.customer_id,ar.original_cents,ar.due_on) IS DISTINCT FROM (issued.customer_id,issued.total_cents,issued.due_on) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_RECEIVABLE_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM crest.invoice_tax_payable_movements t WHERE (t.business_id,t.event_id)=(business,event.id))
  <> (SELECT count(*) FROM crest.invoice_items i WHERE (i.business_id,i.invoice_id)=(business,invoice) AND i.tax_cents>0)
  OR EXISTS(
   SELECT FROM crest.invoice_tax_payable_movements t
   JOIN crest.invoice_items i ON (i.business_id,i.id)=(t.business_id,t.invoice_item_id)
   JOIN crest.tax_profiles p ON (p.business_id,p.id)=(i.business_id,i.tax_profile_id)
   WHERE (t.business_id,t.event_id)=(business,event.id) AND (
    i.invoice_id<>invoice OR t.tax_profile_id<>i.tax_profile_id OR t.jurisdiction<>p.jurisdiction
    OR p.treatment<>'inclusive_single' OR p.synthetic IS DISTINCT FROM true OR t.cents<>i.tax_cents
    OR jsonb_build_object('mappingId',t.mapping_id,'accountId',t.account_id,'accountCode','2100')
     IS DISTINCT FROM crest_private.resolve_invoice_tax_payable_mapping(business,p.jurisdiction,event.effective_on)
   )
  ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_TAX_PAYABLE_EFFECT_REQUIRED';
 END IF;
 SELECT count(*) INTO expected_count FROM crest.invoice_items i CROSS JOIN LATERAL
  (VALUES(i.total_cents),(i.discount_net_cents),(i.gross_net_cents),(i.tax_cents)) amounts(cents)
  WHERE (i.business_id,i.invoice_id)=(business,invoice) AND amounts.cents>0;
 expected_zero:=expected_count=0;
 SELECT j.* INTO entry FROM crest.journal_entries j WHERE (j.business_id,j.event_id,j.entry_sequence)=(business,event.id,1);
 IF expected_zero IS DISTINCT FROM (event.zero_effect_reason IS NOT NULL)
  OR (entry.id IS NULL)<>expected_zero
  OR EXISTS(SELECT FROM crest.journal_entries j WHERE (j.business_id,j.event_id)=(business,event.id) AND j.entry_sequence<>1) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_JOURNAL_REQUIRED';
 END IF;
 IF expected_zero THEN RETURN; END IF;
 SELECT count(*),sum(l.debit_cents),sum(l.credit_cents) INTO actual_count,debits,credits
 FROM crest.journal_lines l WHERE (l.business_id,l.entry_id)=(business,entry.id);
 IF actual_count<2 OR actual_count<>expected_count OR debits<>credits OR EXISTS(
  SELECT FROM crest.journal_lines l
  JOIN crest.invoice_items i ON (i.business_id,i.id)=(l.business_id,l.invoice_item_id)
  LEFT JOIN crest.account_mapping_versions m ON (m.business_id,m.id)=(l.business_id,l.fixed_mapping_id)
  LEFT JOIN crest.invoice_tax_payable_movements t ON (t.business_id,t.id)=(l.business_id,l.tax_payable_movement_id)
  JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id)
  WHERE (l.business_id,l.entry_id)=(business,entry.id) AND (
   i.invoice_id<>invoice
   OR (l.purpose='tax_payable' AND (t.event_id,t.invoice_item_id,t.account_id,l.debit_cents,l.credit_cents)
    IS DISTINCT FROM (event.id,i.id,l.account_id,0::bigint,i.tax_cents))
   OR (l.purpose<>'tax_payable' AND (
    (m.purpose,m.account_id) IS DISTINCT FROM (l.purpose,l.account_id)
    OR m.effective_from>event.effective_on OR NOT crest_private.fixed_finance_mapping_matches(l.purpose,a)
    OR EXISTS(SELECT FROM crest.account_mapping_versions newer WHERE (newer.business_id,newer.purpose)=(m.business_id,m.purpose)
     AND newer.effective_from>m.effective_from AND newer.effective_from<=event.effective_on)
   ))
   OR (SELECT v.active FROM crest.account_versions v WHERE (v.business_id,v.account_id)=(a.business_id,a.id)
    ORDER BY v.version DESC LIMIT 1) IS DISTINCT FROM true
   OR (l.purpose='ar' AND (l.receivable_id,l.account_id,l.debit_cents,l.credit_cents)
    IS DISTINCT FROM (ar.id,ar.account_id,i.total_cents,0::bigint))
   OR (l.purpose='discount' AND (l.debit_cents,l.credit_cents)<>(i.discount_net_cents,0::bigint))
   OR (l.purpose='service_revenue' AND (l.debit_cents,l.credit_cents)<>(0::bigint,i.gross_net_cents))
  )
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_JOURNAL_EFFECT_REQUIRED';
 END IF;
END $posting$;

CREATE FUNCTION crest_private.verify_invoice_posting_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE source_invoice uuid;
BEGIN
 IF TG_TABLE_NAME='invoices' THEN source_invoice:=NEW.id;
 ELSIF TG_TABLE_NAME IN('financial_events','receivable_items') THEN source_invoice:=NEW.invoice_id;
 ELSIF TG_TABLE_NAME='invoice_tax_payable_movements' THEN
  SELECT e.invoice_id INTO STRICT source_invoice FROM crest.financial_events e
   WHERE (e.business_id,e.id)=(NEW.business_id,NEW.event_id);
 ELSIF TG_TABLE_NAME='journal_entries' THEN
  SELECT e.invoice_id INTO STRICT source_invoice FROM crest.financial_events e
   WHERE (e.business_id,e.id)=(NEW.business_id,NEW.event_id);
 ELSE
  SELECT e.invoice_id INTO STRICT source_invoice FROM crest.financial_events e JOIN crest.journal_entries j
   ON (j.business_id,j.event_id)=(e.business_id,e.id) WHERE (j.business_id,j.id)=(NEW.business_id,NEW.entry_id);
 END IF;
 PERFORM crest_private.verify_invoice_posting(NEW.business_id,source_invoice);
 RETURN NULL;
END $posting$;
CREATE FUNCTION crest_private.verify_invoice_group_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $group$
BEGIN
 IF NOT EXISTS(SELECT FROM crest.financial_events e
  WHERE (e.business_id,e.group_id,e.event_sequence)=(NEW.business_id,NEW.id,1)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_POSTING_EVENT_REQUIRED';
 END IF;
 RETURN NULL;
END $group$;
CREATE CONSTRAINT TRIGGER invoice_group_requires_event AFTER INSERT ON crest.atomic_finance_groups
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_invoice_group_source();
DO $ledger$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['invoices','financial_events','receivable_items','invoice_tax_payable_movements','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER invoice_posting_required AFTER INSERT ON crest.%I
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_invoice_posting_rows()',name);
 END LOOP;
END $ledger$;
RESET ROLE;
ALTER FUNCTION crest_private.verify_invoice_posting(uuid,uuid) OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_invoice_posting_rows() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_invoice_group_source() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_invoice_posting(uuid,uuid),crest_private.verify_invoice_posting_rows(),
 crest_private.verify_invoice_group_source() FROM PUBLIC;
