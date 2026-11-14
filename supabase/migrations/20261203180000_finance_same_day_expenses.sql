-- Held same-day P12 and private expense source. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-expense-same-day.sql
-- Held fictional P12. One fully business, ordinary expense, incurred and paid
-- on the same evidenced local date from a reviewed dedicated account.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.posted_expenses (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 expense_id uuid NOT NULL,
 expense_revision bigint NOT NULL,
 incurred_on date NOT NULL,
 paid_on date NOT NULL CHECK(paid_on=incurred_on),
 gross_cents bigint NOT NULL CHECK(gross_cents>0),
 purchase_tax_cents bigint NOT NULL CHECK(purchase_tax_cents>=0 AND purchase_tax_cents<=gross_cents),
 purchase_tax_treatment text NOT NULL CHECK(
  (purchase_tax_treatment='none' AND purchase_tax_cents=0)
  OR (purchase_tax_treatment='verified_nonrecoverable' AND purchase_tax_cents>0)),
 mapping_id uuid NOT NULL,
 expense_account_id uuid NOT NULL,
 channel_version_id uuid NOT NULL,
 money_account_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 receipt_id uuid,
 receipt_revision bigint,
 missing_receipt_reason text,
 unknown_vendor_reason text,
 review_reason text NOT NULL CHECK(char_length(btrim(review_reason))>=1 AND char_length(review_reason)<=1000),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,expense_id),
 UNIQUE(business_id,evidence_id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,expense_id,expense_revision) REFERENCES crest.expense_revisions(business_id,expense_id,revision),
 FOREIGN KEY(business_id,mapping_id) REFERENCES crest.account_mapping_versions(business_id,id),
 FOREIGN KEY(business_id,expense_account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,money_account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,channel_version_id) REFERENCES crest.money_channel_versions(business_id,id),
 FOREIGN KEY(business_id,evidence_id) REFERENCES crest.external_money_evidence(business_id,id),
 FOREIGN KEY(business_id,receipt_id,receipt_revision) REFERENCES crest.expense_receipt_revisions(business_id,receipt_id,revision),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK((receipt_id IS NULL AND receipt_revision IS NULL AND missing_receipt_reason IS NOT NULL)
  OR (receipt_id IS NOT NULL AND receipt_revision IS NOT NULL AND receipt_revision=2 AND missing_receipt_reason IS NULL)),
 CHECK(missing_receipt_reason IS NULL OR char_length(btrim(missing_receipt_reason))>=1 AND char_length(missing_receipt_reason)<=1000),
 CHECK(unknown_vendor_reason IS NULL OR char_length(btrim(unknown_vendor_reason))>=1 AND char_length(unknown_vendor_reason)<=1000)
);
ALTER TABLE crest.posted_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.posted_expenses FORCE ROW LEVEL SECURITY;
CREATE TRIGGER posted_expense_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.posted_expenses
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

ALTER TABLE crest.financial_events ADD COLUMN posted_expense_id uuid;
ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK(
 (template IN('P01','P02') AND invoice_id IS NOT NULL AND payment_id IS NULL AND posted_expense_id IS NULL)
 OR (template='P03' AND payment_id IS NOT NULL AND invoice_id IS NULL AND posted_expense_id IS NULL AND zero_effect_reason IS NULL)
 OR (template='P12' AND posted_expense_id IS NOT NULL AND invoice_id IS NULL AND payment_id IS NULL AND zero_effect_reason IS NULL));
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,posted_expense_id);
ALTER TABLE crest.financial_events ADD FOREIGN KEY(business_id,posted_expense_id) REFERENCES crest.posted_expenses(business_id,id);
ALTER TABLE crest.money_movements DROP CONSTRAINT money_movements_signed_cents_check;
ALTER TABLE crest.money_movements ADD CHECK(signed_cents<>0);
ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK(
 (purpose IN('ar','discount','service_revenue','tax_payable') AND invoice_item_id IS NOT NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL
  AND (purpose='ar')=(receivable_id IS NOT NULL) AND (purpose='tax_payable')=(fixed_mapping_id IS NULL))
 OR (purpose='receipt_money' AND money_movement_id IS NOT NULL AND debit_cents>0 AND credit_cents=0
  AND invoice_item_id IS NULL AND receivable_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL)
 OR (purpose='receipt_ar' AND allocation_event_id IS NOT NULL AND receivable_id IS NOT NULL AND debit_cents=0 AND credit_cents>0
  AND invoice_item_id IS NULL AND money_movement_id IS NULL AND fixed_mapping_id IS NULL)
 OR (purpose='expense_cost' AND fixed_mapping_id IS NOT NULL AND debit_cents>0 AND credit_cents=0
  AND invoice_item_id IS NULL AND receivable_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL)
 OR (purpose='expense_money' AND money_movement_id IS NOT NULL AND debit_cents=0 AND credit_cents>0
  AND invoice_item_id IS NULL AND receivable_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL));

-- Retain both existing source profiles. Only the observed shared physical
-- event schema grows; original columns and the row scopes stay exact.
ALTER POLICY receipt_source_export_read ON crest.money_movements USING(
 business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=money_movements.business_id AND e.id=money_movements.event_id));
ALTER POLICY receipt_source_export_read ON crest.external_money_evidence USING(
 business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.money_movements m WHERE m.business_id=external_money_evidence.business_id AND m.evidence_id=external_money_evidence.id));

CREATE OR REPLACE FUNCTION crest_private.invoice_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
  WHEN 'financial_events' THEN expected_fields||ARRAY['payment_id:uuid','posted_expense_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['money_movement_id:uuid','allocation_event_id:uuid']
  ELSE expected_fields END;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.receipt_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['posted_expense_id:uuid'];END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECEIPT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

GRANT SELECT ON crest.posted_expenses,crest.expense_revisions,crest.expense_receipt_revisions TO crest_finance_integrity_owner;
GRANT SELECT ON crest.expense_revisions,crest.expense_receipt_revisions TO crest_finance_account_owner;
GRANT SELECT,INSERT ON crest.posted_expenses TO crest_finance_account_owner;
CREATE POLICY posted_expense_integrity ON crest.posted_expenses FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY expense_revision_posting_integrity ON crest.expense_revisions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY expense_evidence_posting_integrity ON crest.expense_receipt_revisions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY expense_revision_posting_read ON crest.expense_revisions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY expense_evidence_posting_read ON crest.expense_receipt_revisions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY posted_expense_read ON crest.posted_expenses FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY posted_expense_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.expense.post_same_day');
CREATE POLICY posted_expense_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='posted_expenses');
CREATE POLICY posted_expense_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.expense.post_same_day','finance.expense.retire_same_day'));
CREATE POLICY posted_expense_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.expense.post_same_day','finance.expense.retire_same_day')
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY posted_expense_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.expense.post_same_day','finance.expense.retire_same_day') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.expense.post_same_day','finance.expense.retire_same_day') AND state='committed');
CREATE POLICY posted_expense_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='posted_expenses' AND action='post' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL);

DO $writer$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['posted_expenses','external_money_evidence','money_movements','financial_events',
   'atomic_finance_groups','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE POLICY posted_expense_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o
     WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
      AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
      AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
      AND o.command_type=''finance.expense.post_same_day'' AND o.state=''pending''))',source);
 END LOOP;
END $writer$;

CREATE FUNCTION crest_private.expense_posting_mapping(requested_business uuid,category text,effective_on date)
RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $mapping$
 SELECT m.id FROM (
  SELECT v.* FROM crest.account_mapping_versions v
  WHERE v.business_id=requested_business AND v.purpose='category_'||category AND v.effective_from<=effective_on
  ORDER BY v.effective_from DESC LIMIT 1
 ) m JOIN crest.accounts a ON a.business_id=m.business_id AND a.id=m.account_id
 WHERE a.account_type='expense' AND crest_private.fixed_finance_mapping_matches(m.purpose,a)
  AND (SELECT v.active FROM crest.account_versions v WHERE v.business_id=a.business_id AND v.account_id=a.id
   ORDER BY v.version DESC LIMIT 1);
$mapping$;
REVOKE ALL ON FUNCTION crest_private.expense_posting_mapping(uuid,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.expense_posting_mapping(uuid,text,date) TO crest_finance_integrity_owner,crest_finance_account_owner;
RESET ROLE;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.posted_expense_snapshot(p crest.posted_expenses,event_id uuid,movement_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',p.business_id,'postedExpenseId',p.id,'expenseId',p.expense_id,
  'expenseRevision',p.expense_revision::text,'eventId',event_id,'incurredOn',to_char(p.incurred_on,'YYYY-MM-DD'),
  'paidOn',to_char(p.paid_on,'YYYY-MM-DD'),'grossCents',p.gross_cents::text,'purchaseTaxCents',p.purchase_tax_cents::text,
  'purchaseTaxTreatment',p.purchase_tax_treatment,'mappingId',p.mapping_id,'expenseAccountId',p.expense_account_id,
  'channelVersionId',p.channel_version_id,'moneyAccountId',p.money_account_id,'externalEvidenceId',p.evidence_id,
  'moneyMovementId',movement_id,'receiptId',p.receipt_id,'receiptRevision',p.receipt_revision::text,
  'missingReceiptReason',p.missing_receipt_reason,'unknownVendorReason',p.unknown_vendor_reason);
$receipt$;
REVOKE ALL ON FUNCTION crest_private.posted_expense_snapshot(crest.posted_expenses,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.posted_expense_snapshot(crest.posted_expenses,uuid,uuid)
 TO crest_finance_integrity_owner,crest_finance_account_owner;

CREATE FUNCTION crest_private.verify_same_day_expense(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; p crest.posted_expenses; draft crest.expense_revisions; c crest.money_channel_versions;
 movement crest.money_movements; evidence crest.external_money_evidence; journal uuid; receipt jsonb;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT p FROM crest.posted_expenses WHERE business_id=requested_business AND id=e.posted_expense_id;
 SELECT * INTO draft FROM crest.expense_revisions d WHERE d.business_id=p.business_id AND d.expense_id=p.expense_id
  ORDER BY d.revision DESC LIMIT 1;
 SELECT * INTO c FROM crest.money_channel_versions WHERE business_id=p.business_id AND id=p.channel_version_id;
 SELECT * INTO movement FROM crest.money_movements WHERE business_id=p.business_id AND event_id=e.id;
 SELECT * INTO evidence FROM crest.external_money_evidence WHERE business_id=p.business_id AND id=p.evidence_id;
 SELECT j.id INTO journal FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id AND j.entry_sequence=1;
 receipt:=crest_private.posted_expense_snapshot(p,e.id,movement.id);
 IF (e.template,e.event_sequence,e.effective_on) IS DISTINCT FROM ('P12'::text,1,p.incurred_on)
  OR e.posted_at<p.created_at OR p.paid_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR draft.revision IS DISTINCT FROM p.expense_revision OR draft.payload->'voided' IS DISTINCT FROM 'false'::jsonb
  OR draft.payload->>'currency' IS DISTINCT FROM 'USD' OR (draft.payload->>'paidOn')::date IS DISTINCT FROM p.paid_on
  OR (draft.payload->>'amountCents')::bigint IS DISTINCT FROM p.gross_cents
  OR ((draft.payload->>'vendor') IS NULL) IS DISTINCT FROM (p.unknown_vendor_reason IS NOT NULL)
  OR p.mapping_id IS DISTINCT FROM crest_private.expense_posting_mapping(p.business_id,draft.payload->>'category',p.incurred_on)
  OR NOT EXISTS(SELECT FROM crest.account_mapping_versions m WHERE m.business_id=p.business_id AND m.id=p.mapping_id
    AND m.account_id=p.expense_account_id)
  OR p.receipt_id IS NOT NULL AND NOT EXISTS(SELECT FROM crest.expense_receipt_revisions r
    WHERE r.business_id=p.business_id AND r.receipt_id=p.receipt_id AND r.revision=p.receipt_revision
     AND r.expense_id=p.expense_id AND r.expense_revision=p.expense_revision AND r.candidate IS NOT NULL)
  OR c.account_id IS DISTINCT FROM p.money_account_id
  OR c.id IS DISTINCT FROM crest_private.direct_receipt_channel(p.business_id,c.channel_id,p.paid_on,e.time_zone)
  OR movement.id IS NULL OR (movement.account_id,movement.evidence_id,movement.signed_cents)
    IS DISTINCT FROM (p.money_account_id,p.evidence_id,-p.gross_cents)
  OR evidence.id IS NULL OR (evidence.provider_namespace,evidence.external_account_id,evidence.confirmed_on,evidence.signed_cents,evidence.currency)
    IS DISTINCT FROM (c.provider_namespace,p.money_account_id,p.paid_on,-p.gross_cents,'USD'::text)
  OR NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
    JOIN crest_private.operations o ON o.business_id=g.business_id AND o.operation_id=g.operation_id AND o.actor_id=g.created_by
    JOIN crest.accounting_periods period ON period.business_id=e.business_id AND period.id=e.period_id
    JOIN crest_private.audit_events a ON a.business_id=o.business_id AND a.operation_id=o.operation_id AND a.actor_id=o.actor_id
    WHERE g.business_id=e.business_id AND g.id=e.group_id AND g.operation_id=p.operation_id AND g.created_by=p.created_by
     AND o.recovery_epoch=g.recovery_epoch AND o.state='committed' AND o.command_type='finance.expense.post_same_day'
     AND o.result=receipt AND a.entity_kind='posted_expenses' AND a.entity_id=p.id AND a.entity_version=1 AND a.action='post'
     AND a.reason=p.review_reason AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
     AND period.time_zone=e.time_zone AND e.effective_on>=period.starts_on AND e.effective_on<=period.through_on
     AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
      WHERE h.business_id=period.business_id AND h.period_id=period.id),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_SOURCE_REQUIRED';END IF;

 IF journal IS NULL OR (SELECT count(*) FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id)<>1
  OR (SELECT count(*) FROM crest.journal_lines l WHERE l.business_id=e.business_id AND l.entry_id=journal)<>2
  OR NOT EXISTS(SELECT FROM crest.journal_lines l WHERE l.business_id=e.business_id AND l.entry_id=journal
    AND l.purpose='expense_cost' AND l.account_id=p.expense_account_id AND l.fixed_mapping_id=p.mapping_id
    AND l.debit_cents=p.gross_cents AND l.credit_cents=0)
  OR NOT EXISTS(SELECT FROM crest.journal_lines l WHERE l.business_id=e.business_id AND l.entry_id=journal
    AND l.purpose='expense_money' AND l.account_id=p.money_account_id AND l.money_movement_id=movement.id
    AND l.credit_cents=p.gross_cents AND l.debit_cents=0)
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements t WHERE t.business_id=e.business_id AND t.event_id=e.id)
  OR EXISTS(SELECT FROM crest.allocation_events a WHERE a.business_id=e.business_id AND a.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_JOURNAL_REQUIRED';END IF;
END $verify$;

CREATE FUNCTION crest_private.verify_same_day_expense_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE event_id uuid;
BEGIN
 SELECT e.id INTO event_id FROM crest.financial_events e WHERE e.business_id=NEW.business_id AND e.posted_expense_id=NEW.id;
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_same_day_expense(NEW.business_id,event_id);
 RETURN NULL;
END $verify$;

CREATE FUNCTION crest_private.keep_posted_expense_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $keep$
BEGIN
 IF EXISTS(SELECT FROM crest.posted_expenses p WHERE p.business_id=NEW.business_id AND p.expense_id=NEW.expense_id) THEN
  RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='EXPENSE_VERSION_CONFLICT';
 END IF;
 RETURN NEW;
END $keep$;

RESET ROLE;
ALTER FUNCTION crest_private.verify_same_day_expense(uuid,uuid) OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_same_day_expense_row() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.keep_posted_expense_revision() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_same_day_expense(uuid,uuid),crest_private.verify_same_day_expense_row(),
 crest_private.keep_posted_expense_revision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_same_day_expense_row(),crest_private.keep_posted_expense_revision() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER posted_expense_complete AFTER INSERT ON crest.posted_expenses
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_same_day_expense_row();
CREATE TRIGGER posted_expense_revision_fence BEFORE INSERT ON crest.expense_revisions
 FOR EACH ROW EXECUTE FUNCTION crest_private.keep_posted_expense_revision();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_same_day_expense_row(),crest_private.keep_posted_expense_revision() FROM crest_schema_owner;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.verify_finance_event_posting(requested_business uuid, requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE saved crest.financial_events;
BEGIN
 SELECT e.* INTO saved FROM crest.financial_events e WHERE e.business_id=requested_business AND e.id=requested_event;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_EVENT_REQUIRED';END IF;
 CASE saved.template
  WHEN 'P01','P02' THEN PERFORM crest_private.verify_invoice_posting(saved.business_id,saved.invoice_id);
  WHEN 'P03' THEN PERFORM crest_private.verify_direct_receipt(saved.business_id,saved.id);
  WHEN 'P12' THEN PERFORM crest_private.verify_same_day_expense(saved.business_id,saved.id);
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_TEMPLATE_NOT_SUPPORTED';
 END CASE;
END $posting$;

CREATE OR REPLACE FUNCTION crest_private.verify_direct_receipt_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE source_event uuid;
BEGIN
 CASE TG_TABLE_NAME
  WHEN 'payments' THEN SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND payment_id=NEW.id;
  WHEN 'external_money_evidence' THEN SELECT event_id INTO source_event FROM crest.money_movements WHERE business_id=NEW.business_id AND evidence_id=NEW.id;
  WHEN 'funding_origins' THEN SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND payment_id=NEW.payment_id;
  WHEN 'funding_partitions' THEN SELECT event_id INTO source_event FROM crest.allocation_events WHERE business_id=NEW.business_id AND partition_id=NEW.id;
  WHEN 'allocation_events' THEN
   SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND id=NEW.event_id AND template='P03';
  ELSE source_event:=NEW.event_id;
 END CASE;
 IF source_event IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_finance_event_posting(NEW.business_id,source_event);
 RETURN NULL;
END $verify$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.post_fictional_same_day_expense(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_post uuid,requested_expense uuid,expected_revision bigint,
 requested_channel uuid,expected_channel_version bigint,expected_mapping uuid,incurred_on date,paid_on date,
 purchase_tax_treatment text,purchase_tax_cents bigint,requested_receipt uuid,missing_receipt_reason text,
 unknown_vendor_reason text,review_reason text,external_identity jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $post$
DECLARE
 auth jsonb; digest text; saved record; draft crest.expense_revisions; posted crest.posted_expenses;
 channel crest.money_channel_versions; mapping crest.account_mapping_versions; period record; gross bigint;
 group_id uuid; event_id uuid; journal_id uuid; evidence_id uuid; movement_id uuid; claimed uuid; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_post IS NULL OR requested_expense IS NULL OR expected_revision IS NULL OR expected_revision<1
  OR requested_channel IS NULL OR expected_channel_version IS NULL OR expected_channel_version<1 OR expected_mapping IS NULL
  OR incurred_on IS NULL OR paid_on IS NULL OR incurred_on<DATE '1900-01-01' OR incurred_on>DATE '9999-12-31'
  OR paid_on<DATE '1900-01-01' OR paid_on>DATE '9999-12-31'
  OR purchase_tax_treatment IS NULL OR purchase_tax_treatment NOT IN('none','verified_nonrecoverable')
  OR purchase_tax_cents IS NULL OR (purchase_tax_treatment='none' AND purchase_tax_cents<>0)
  OR (purchase_tax_treatment='verified_nonrecoverable' AND purchase_tax_cents<=0)
  OR (requested_receipt IS NULL) IS DISTINCT FROM (missing_receipt_reason IS NOT NULL)
  OR review_reason IS NULL OR EXISTS(SELECT FROM unnest(ARRAY[review_reason,missing_receipt_reason,unknown_vendor_reason]) AS t(value)
   WHERE t.value IS NOT NULL AND (char_length(t.value) NOT BETWEEN 1 AND 1000 OR t.value<>btrim(t.value) OR t.value~'[[:cntrl:]]'))
  OR jsonb_typeof(external_identity) IS DISTINCT FROM 'object' OR octet_length(external_identity::text)>8192
  OR NOT external_identity?&ARRAY['namespace','id','rawReference']
  OR external_identity-ARRAY['namespace','id','rawReference']<>'{}'::jsonb
  OR jsonb_typeof(external_identity->'namespace') IS DISTINCT FROM 'string'
  OR jsonb_typeof(external_identity->'id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(external_identity->'rawReference') IS DISTINCT FROM 'string'
  OR external_identity->>'namespace'!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
  OR char_length(external_identity->>'id') NOT BETWEEN 1 AND 200
  OR external_identity->>'id'<>btrim(external_identity->>'id') OR external_identity->>'id'~'[[:cntrl:]]'
  OR char_length(external_identity->>'rawReference') NOT BETWEEN 1 AND 1000
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PAID_EXPENSE_INPUT_REQUIRED';END IF;
 IF incurred_on<>paid_on THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_SAME_DATE_REQUIRED';END IF;

 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.expense.post_same_day',1,requested_business,expected_actor,
  expected_epoch,requested_post,requested_expense,expected_revision,requested_channel,expected_channel_version,expected_mapping,
  incurred_on,paid_on,purchase_tax_treatment,purchase_tax_cents,requested_receipt,missing_receipt_reason,
  unknown_vendor_reason,review_reason,external_identity)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.expense.post_same_day',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.expense.post_same_day' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;

 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 -- The legacy editor already holds exactly this lock when appending a revision.
 PERFORM pg_advisory_xact_lock(hashtextextended(requested_business::text||requested_expense::text,0));
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO draft FROM crest.expense_revisions d WHERE d.business_id=requested_business AND d.expense_id=requested_expense
  ORDER BY d.revision DESC LIMIT 1;
 IF NOT FOUND OR draft.revision<>expected_revision OR draft.payload->'voided' IS DISTINCT FROM 'false'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_CURRENT_REVISION_REQUIRED';
 END IF;
 IF (draft.payload->>'paidOn')::date<>paid_on OR paid_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_SAME_DATE_REQUIRED';
 END IF;
 gross:=(draft.payload->>'amountCents')::bigint;
 IF purchase_tax_cents>gross THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_PURCHASE_TAX_REVIEW_REQUIRED';END IF;
 IF ((draft.payload->>'vendor') IS NULL) IS DISTINCT FROM (unknown_vendor_reason IS NOT NULL)
  OR requested_receipt IS NOT NULL AND NOT EXISTS(SELECT FROM crest.expense_receipt_revisions r
    WHERE r.business_id=requested_business AND r.receipt_id=requested_receipt AND r.revision=2
     AND r.expense_id=requested_expense AND r.expense_revision=expected_revision AND r.candidate IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_EVIDENCE_REQUIRED';
 END IF;
 IF EXISTS(SELECT FROM crest.posted_expenses p WHERE p.business_id=requested_business AND (p.expense_id=requested_expense OR p.id=requested_post)) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PAID_EXPENSE_ALREADY_POSTED';
 END IF;
 SELECT * INTO mapping FROM crest.account_mapping_versions m WHERE m.business_id=requested_business AND m.id=expected_mapping
  AND m.id=crest_private.expense_posting_mapping(requested_business,draft.payload->>'category',incurred_on);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_ORDINARY_MAPPING_REQUIRED';END IF;
 SELECT * INTO channel FROM crest.money_channel_versions v WHERE v.business_id=requested_business
  AND v.id=crest_private.direct_receipt_channel(requested_business,requested_channel,paid_on,auth->>'timezone');
 IF NOT FOUND OR channel.version<>expected_channel_version THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_VERIFIED_CHANNEL_REQUIRED';
 END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,incurred_on,auth->>'timezone');
 IF EXISTS(SELECT FROM crest.external_money_evidence ev WHERE ev.business_id=requested_business
   AND ev.provider_namespace=channel.provider_namespace AND ev.external_account_id=channel.account_id
   AND ev.id_namespace=external_identity->>'namespace' AND ev.external_id=external_identity->>'id') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PAID_EXPENSE_EXTERNAL_ID_ALREADY_RECORDED';
 END IF;
 INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
  normalization_rule,confirmed_on,signed_cents,currency)
 VALUES(requested_business,channel.provider_namespace,channel.account_id,external_identity->>'namespace',external_identity->>'id',
  external_identity->>'rawReference','exact_case_v1',paid_on,-gross,'USD') RETURNING id INTO evidence_id;
 INSERT INTO crest.posted_expenses(id,business_id,expense_id,expense_revision,incurred_on,paid_on,gross_cents,purchase_tax_cents,
  purchase_tax_treatment,mapping_id,expense_account_id,channel_version_id,money_account_id,evidence_id,receipt_id,receipt_revision,
  missing_receipt_reason,unknown_vendor_reason,review_reason,operation_id,created_by)
 VALUES(requested_post,requested_business,requested_expense,expected_revision,incurred_on,paid_on,gross,purchase_tax_cents,
  purchase_tax_treatment,mapping.id,mapping.account_id,channel.id,channel.account_id,evidence_id,requested_receipt,
  CASE WHEN requested_receipt IS NOT NULL THEN 2 END,missing_receipt_reason,unknown_vendor_reason,review_reason,requested_operation,expected_actor)
 RETURNING * INTO posted;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,posted_expense_id,period_id,period_generation,effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,requested_post,period.period_id,period.generation,incurred_on,auth->>'timezone','P12',1)
 RETURNING id INTO event_id;
 INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
 VALUES(requested_business,event_id,channel.account_id,evidence_id,-gross) RETURNING id INTO movement_id;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,event_id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,mapping.account_id,mapping.id,'expense_cost',gross,0);
 INSERT INTO crest.journal_lines(business_id,entry_id,account_id,money_movement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,channel.account_id,movement_id,'expense_money',0,gross);
 receipt:=crest_private.posted_expense_snapshot(posted,event_id,movement_id);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'posted_expenses',requested_post,1,'post',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $post$;

CREATE FUNCTION crest_commands.lookup_fictional_same_day_expense(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_post uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_post IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PAID_EXPENSE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT o.id,o.command_type,o.recovery_epoch,o.result,o.payload_hash,p.id AS post_id INTO saved
 FROM crest_private.operations o LEFT JOIN crest.posted_expenses p ON p.business_id=o.business_id AND p.operation_id=o.operation_id
 WHERE o.business_id=requested_business AND o.operation_id=original_operation AND o.actor_id=expected_actor
  AND o.command_type IN('finance.expense.post_same_day','finance.expense.retire_same_day') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.command_type='finance.expense.retire_same_day' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'postedExpenseId') IS DISTINCT FROM (original_epoch::text,original_post::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.delta INTO audit_delta FROM crest_private.audit_events a
  WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
   AND a.entity_kind='operations' AND a.entity_id=saved.id AND a.action='retire' AND a.reason=saved.result->>'reason';
  IF saved.post_id IS NOT NULL OR saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAID_EXPENSE_RETIREMENT_AUDIT_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF (saved.recovery_epoch,saved.post_id) IS DISTINCT FROM (original_epoch,original_post) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.post_fictional_same_day_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,bigint,uuid,bigint,uuid,date,date,text,bigint,uuid,text,text,text,jsonb) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_same_day_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.post_fictional_same_day_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,bigint,uuid,bigint,uuid,date,date,text,bigint,uuid,text,text,text,jsonb),
 crest_commands.lookup_fictional_same_day_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.post_fictional_same_day_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,bigint,uuid,bigint,uuid,date,date,text,bigint,uuid,text,text,text,jsonb),
 crest_commands.lookup_fictional_same_day_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_same_day_expense_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_expense uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; draft crest.expense_revisions; p crest.posted_expenses; actual_date date;
 event_id uuid; movement_id uuid; mapping_id uuid; mapping jsonb; channels jsonb; receipts jsonb; open_period boolean;
BEGIN
 IF requested_expense IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PAID_EXPENSE_INPUT_REQUIRED';END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO p FROM crest.posted_expenses s WHERE s.business_id=requested_business AND s.expense_id=requested_expense;
 IF FOUND THEN
  SELECT e.id,m.id INTO STRICT event_id,movement_id FROM crest.financial_events e JOIN crest.money_movements m
   ON m.business_id=e.business_id AND m.event_id=e.id WHERE e.business_id=p.business_id AND e.posted_expense_id=p.id;
  RETURN jsonb_build_object('state','posted','receipt',crest_private.posted_expense_snapshot(p,event_id,movement_id));
 END IF;
 SELECT * INTO draft FROM crest.expense_revisions d WHERE d.business_id=requested_business AND d.expense_id=requested_expense
  ORDER BY d.revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF draft.payload->'voided'='true'::jsonb THEN RETURN jsonb_build_object('state','voided');END IF;
 actual_date:=(draft.payload->>'paidOn')::date;
 mapping_id:=crest_private.expense_posting_mapping(requested_business,draft.payload->>'category',actual_date);
 SELECT jsonb_build_object('mappingId',m.id,'accountId',m.account_id,'accountCode',a.code,'purpose',m.purpose)
 INTO mapping FROM crest.account_mapping_versions m JOIN crest.accounts a ON a.business_id=m.business_id AND a.id=m.account_id
 WHERE m.business_id=requested_business AND m.id=mapping_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',c.channel_id,'channelVersionId',c.id,'version',c.version::text,
  'accountId',c.account_id,'label',c.label,'kind',c.kind) ORDER BY c.label,c.id),'[]'::jsonb)
 INTO channels FROM (
  SELECT v.* FROM crest.money_channel_versions v WHERE v.business_id=requested_business
   AND v.id=crest_private.direct_receipt_channel(requested_business,v.channel_id,actual_date,auth->>'timezone')
  ORDER BY v.label,v.id LIMIT 181
 ) c;
 SELECT coalesce(jsonb_agg(jsonb_build_object('receiptId',r.receipt_id,'revision',r.revision::text)
  ORDER BY r.receipt_id),'[]'::jsonb) INTO receipts FROM (
  SELECT e.receipt_id,e.revision FROM crest.expense_receipt_revisions e WHERE e.business_id=requested_business
   AND e.expense_id=requested_expense AND e.expense_revision=draft.revision AND e.revision=2 AND e.candidate IS NOT NULL
  ORDER BY e.receipt_id LIMIT 181
 ) r;
 IF jsonb_array_length(channels)>180 OR jsonb_array_length(receipts)>180 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='PAID_EXPENSE_OPTIONS_LIMIT';
 END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods a
  LEFT JOIN LATERAL (SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=a.business_id AND h.period_id=a.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE a.business_id=requested_business AND a.time_zone=auth->>'timezone'
   AND actual_date>=a.starts_on AND actual_date<=a.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('state','review','schemaVersion',1,'businessId',requested_business,'expenseId',requested_expense,
  'expenseRevision',draft.revision::text,'retainedPaidOn',draft.payload->>'paidOn','grossCents',draft.payload->>'amountCents',
  'category',draft.payload->>'category','description',draft.payload->>'description','vendor',draft.payload->>'vendor',
  'mapping',mapping,'channels',channels,'validatedReceipts',receipts,'openPeriod',open_period);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_same_day_expense_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_same_day_expense_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_same_day_expense_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY posted_expense_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.expense.retire_same_day' AND o.state='pending'));

CREATE FUNCTION crest_commands.retire_fictional_same_day_expense(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_post uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR
  review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PAID_EXPENSE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_same_day_expense($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'postedExpenseId',original_post,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.expense.retire_same_day',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_same_day_expense($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
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
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_same_day_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_same_day_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_same_day_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-expense-same-day.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-expense-same-day-source.sql
-- Held exact P12 source. A closed definer separates expense rows from P01/P03.
DO $review$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='crest_paid_expense_export_owner') OR
  NOT EXISTS(SELECT FROM pg_roles WHERE rolname='crest_export'
   AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('crest_commands.business_history_export_context(uuid)')
   AND proowner='crest_export_owner'::regrole AND prosecdef)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_AUTHORITY_REVIEW_REQUIRED';END IF;
END $review$;
CREATE ROLE crest_paid_expense_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_paid_expense_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_commands,crest_private TO crest_paid_expense_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid),
 crest_commands.business_configuration_export_context(uuid) TO crest_paid_expense_export_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.posted_expense_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('posted_expenses', ARRAY[
  'id:uuid', 'business_id:uuid', 'expense_id:uuid', 'expense_revision:bigint',
  'incurred_on:date', 'paid_on:date', 'gross_cents:bigint', 'purchase_tax_cents:bigint',
  'purchase_tax_treatment:text', 'mapping_id:uuid', 'expense_account_id:uuid', 'channel_version_id:uuid',
  'money_account_id:uuid', 'evidence_id:uuid', 'receipt_id:uuid', 'receipt_revision:bigint',
  'missing_receipt_reason:text', 'unknown_vendor_reason:text', 'review_reason:text', 'operation_id:uuid',
  'created_by:uuid', 'created_at:timestamp with time zone'
 ]),
 ('external_money_evidence', ARRAY[
  'id:uuid', 'business_id:uuid', 'provider_namespace:text', 'external_account_id:uuid',
  'id_namespace:text', 'external_id:text', 'raw_reference:text', 'normalization_rule:text',
  'confirmed_on:date', 'signed_cents:bigint', 'currency:text'
 ]),
 ('money_movements', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'account_id:uuid',
  'evidence_id:uuid', 'signed_cents:bigint'
 ]),
 ('atomic_finance_groups', ARRAY[
  'id:uuid', 'business_id:uuid', 'commit_sequence:bigint', 'recovery_epoch:uuid',
  'created_by:uuid', 'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('financial_events', ARRAY[
  'id:uuid', 'business_id:uuid', 'group_id:uuid', 'event_sequence:integer',
  'invoice_id:uuid', 'period_id:uuid', 'period_generation:bigint', 'reopened_generation:bigint',
  'effective_on:date', 'time_zone:text', 'template:text', 'template_version:integer',
  'zero_effect_reason:text', 'posted_at:timestamp with time zone', 'payment_id:uuid', 'posted_expense_id:uuid'
 ]),
 ('journal_entries', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'entry_sequence:integer'
 ]),
 ('journal_lines', ARRAY[
  'id:uuid', 'business_id:uuid', 'entry_id:uuid', 'invoice_item_id:uuid',
  'receivable_id:uuid', 'account_id:uuid', 'fixed_mapping_id:uuid', 'tax_payable_movement_id:uuid',
  'purpose:text', 'debit_cents:bigint', 'credit_cents:bigint', 'money_movement_id:uuid',
  'allocation_event_id:uuid'
 ]);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.posted_expense_source_dictionary() FROM PUBLIC;

CREATE FUNCTION crest_private.posted_expense_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
REVOKE ALL ON FUNCTION crest_private.posted_expense_source_check_group(text,text[]) FROM PUBLIC;

CREATE FUNCTION crest_private.posted_expense_source_token(requested_business uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $token$
DECLARE snapshot_value text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_SCOPE_REQUIRED';END IF;
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_LIMIT';END IF;
 RETURN encode(sha256(convert_to(jsonb_build_array('crest.same-day.expense.sources/1',requested_business,
  pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
END $token$;
REVOKE ALL ON FUNCTION crest_private.posted_expense_source_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.posted_expense_source_dictionary(),
 crest_private.posted_expense_source_check_group(text,text[]),crest_private.posted_expense_source_token(uuid) TO crest_paid_expense_export_owner;

DO $grants$
DECLARE source record; columns text;
BEGIN
 FOR source IN SELECT * FROM crest_private.posted_expense_source_dictionary() LOOP
  PERFORM crest_private.posted_expense_source_check_group(source.group_name,source.fields);
  IF has_any_column_privilege('crest_export',format('crest.%I',source.group_name),'SELECT,INSERT,UPDATE,REFERENCES')
   OR has_table_privilege('crest_export',format('crest.%I',source.group_name),'DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_AUTHORITY_REVIEW_REQUIRED';
  END IF;
  SELECT string_agg(format('%I',split_part(field,':',1)),',') INTO columns FROM unnest(source.fields) AS field;
  EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_paid_expense_export_owner',columns,source.group_name);
 END LOOP;
END $grants$;
CREATE POLICY posted_expense_source_export_read ON crest.posted_expenses FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY posted_expense_source_export_read ON crest.money_movements FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=money_movements.business_id AND e.id=money_movements.event_id));
CREATE POLICY posted_expense_source_export_read ON crest.external_money_evidence FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.money_movements m WHERE m.business_id=external_money_evidence.business_id AND m.evidence_id=external_money_evidence.id));
CREATE POLICY posted_expense_source_export_read ON crest.financial_events FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND template='P12');
CREATE POLICY posted_expense_source_export_read ON crest.atomic_finance_groups FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=atomic_finance_groups.business_id AND e.group_id=atomic_finance_groups.id));
CREATE POLICY posted_expense_source_export_read ON crest.journal_entries FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=journal_entries.business_id AND e.id=journal_entries.event_id));
CREATE POLICY posted_expense_source_export_read ON crest.journal_lines FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.journal_entries j WHERE j.business_id=journal_lines.business_id AND j.id=journal_lines.entry_id));

CREATE FUNCTION crest_commands.posted_expense_source_snapshot_context(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.posted_expense_source_token(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.posted_expense_source_dictionary() LOOP
  PERFORM crest_private.posted_expense_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'scope','same_day_expense_sources','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.posted_expense_source_snapshot_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.posted_expense_source_token(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.posted_expense_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.posted_expense_source_check_group(requested_group,fields);
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
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_paid_expense_export_owner;
ALTER FUNCTION crest_commands.posted_expense_source_snapshot_context(uuid) OWNER TO crest_paid_expense_export_owner;
ALTER FUNCTION crest_commands.posted_expense_source_snapshot_page(uuid,text,text,uuid,integer) OWNER TO crest_paid_expense_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_paid_expense_export_owner;
REVOKE ALL ON FUNCTION crest_commands.posted_expense_source_snapshot_context(uuid),
 crest_commands.posted_expense_source_snapshot_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.posted_expense_source_snapshot_context(uuid),
 crest_commands.posted_expense_source_snapshot_page(uuid,text,text,uuid,integer) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-expense-same-day-source.sql
