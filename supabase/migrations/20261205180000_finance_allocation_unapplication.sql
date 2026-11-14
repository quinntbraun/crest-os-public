-- Held P05 and private unapplication source. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-allocation-unapply.sql
-- Held P05 funding lineage and typed native posting. No provider money action.
-- Apply only after the exact registered invoice, receipt, expense and report SQL.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.allocation_unapplications (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 allocation_id uuid NOT NULL,
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000 AND reason=btrim(reason) AND reason!~'[[:cntrl:]]'),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,allocation_id) REFERENCES crest.allocation_events(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,allocation_id extensions.gist_uuid_ops WITH =,
  numrange(first_cent::numeric,last_cent::numeric,'[]') WITH &&)
);
CREATE TABLE crest.customer_fund_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 unapplication_id uuid NOT NULL,
 origin_id uuid NOT NULL,
 parent_partition_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 account_id uuid NOT NULL,
 mapping_id uuid NOT NULL,
 original_cents bigint NOT NULL CHECK(original_cents>0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,unapplication_id),
 FOREIGN KEY(business_id,unapplication_id) REFERENCES crest.allocation_unapplications(business_id,id),
 FOREIGN KEY(business_id,origin_id) REFERENCES crest.funding_origins(business_id,id),
 FOREIGN KEY(business_id,parent_partition_id) REFERENCES crest.funding_partitions(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,mapping_id) REFERENCES crest.account_mapping_versions(business_id,id)
);
CREATE INDEX customer_funds_origin ON crest.customer_fund_lots(business_id,origin_id);
ALTER TABLE crest.financial_events ADD COLUMN unapplication_id uuid;
ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK(
 (template IN('P01','P02') AND invoice_id IS NOT NULL AND payment_id IS NULL AND posted_expense_id IS NULL AND unapplication_id IS NULL)
 OR (template='P03' AND payment_id IS NOT NULL AND invoice_id IS NULL AND posted_expense_id IS NULL AND unapplication_id IS NULL
  AND zero_effect_reason IS NULL)
 OR (template='P12' AND posted_expense_id IS NOT NULL AND invoice_id IS NULL AND payment_id IS NULL AND unapplication_id IS NULL
  AND zero_effect_reason IS NULL)
 OR (template='P05' AND unapplication_id IS NOT NULL AND invoice_id IS NULL AND payment_id IS NULL AND posted_expense_id IS NULL
  AND zero_effect_reason IS NULL));
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,unapplication_id);
ALTER TABLE crest.financial_events ADD FOREIGN KEY(business_id,unapplication_id) REFERENCES crest.allocation_unapplications(business_id,id);

ALTER TABLE crest.journal_lines ADD COLUMN unapplication_id uuid;
ALTER TABLE crest.journal_lines ADD COLUMN fund_lot_id uuid;
ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK(
 (purpose IN('ar','discount','service_revenue','tax_payable') AND invoice_item_id IS NOT NULL AND money_movement_id IS NULL
  AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL
  AND (purpose='ar')=(receivable_id IS NOT NULL) AND (purpose='tax_payable')=(fixed_mapping_id IS NULL))
 OR (purpose='receipt_money' AND money_movement_id IS NOT NULL AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL
  AND receivable_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='receipt_ar' AND allocation_event_id IS NOT NULL AND receivable_id IS NOT NULL AND debit_cents=0 AND credit_cents>0
  AND invoice_item_id IS NULL AND money_movement_id IS NULL AND fixed_mapping_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='expense_cost' AND fixed_mapping_id IS NOT NULL AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL
  AND receivable_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='expense_money' AND money_movement_id IS NOT NULL AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL
  AND receivable_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='unapply_ar' AND unapplication_id IS NOT NULL AND receivable_id IS NOT NULL AND debit_cents>0 AND credit_cents=0
  AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='unapply_funds' AND unapplication_id IS NOT NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND receivable_id IS NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL));
ALTER TABLE crest.journal_lines ADD UNIQUE(business_id,unapplication_id,purpose);
ALTER TABLE crest.journal_lines ADD UNIQUE(business_id,fund_lot_id);
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,unapplication_id) REFERENCES crest.allocation_unapplications(business_id,id);
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,fund_lot_id) REFERENCES crest.customer_fund_lots(business_id,id);

DO $storage$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['allocation_unapplications','customer_fund_lots'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',source);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',source);
  EXECUTE format('GRANT SELECT ON crest.%I TO crest_finance_integrity_owner',source);
  EXECUTE format('CREATE POLICY unapplication_integrity ON crest.%I FOR SELECT TO crest_finance_integrity_owner USING(true)',source);
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_finance_account_owner',source);
  EXECUTE format('CREATE POLICY unapplication_read ON crest.%I FOR SELECT TO crest_finance_account_owner
   USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',source);
  EXECUTE format('CREATE TRIGGER unapplication_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I
   FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',source);
 END LOOP;
END $storage$;

-- Live AR as of a date. P03 creates a negative item delta and P05 creates a
-- positive one. Check every chronological boundary before a new posting.
CREATE FUNCTION crest_private.receivable_posted_deltas(requested_business uuid,requested_receivable uuid)
RETURNS TABLE(effective_on date,commit_sequence bigint,event_sequence integer,signed_cents numeric)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $deltas$
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,-a.cents::numeric
 FROM crest.allocation_events a JOIN crest.financial_events e ON e.business_id=a.business_id AND e.id=a.event_id
 JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
 WHERE a.business_id=requested_business AND a.receivable_id=requested_receivable
 UNION ALL
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,u.last_cent::numeric-u.first_cent+1
 FROM crest.allocation_unapplications u JOIN crest.allocation_events a ON a.business_id=u.business_id AND a.id=u.allocation_id
 JOIN crest.financial_events e ON e.business_id=u.business_id AND e.unapplication_id=u.id
 JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
 WHERE u.business_id=requested_business AND a.receivable_id=requested_receivable;
$deltas$;
CREATE FUNCTION crest_private.receivable_has_nonnegative_history(requested_business uuid,requested_receivable uuid,original_cents bigint)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
 SELECT NOT EXISTS(
  SELECT FROM (SELECT original_cents+sum(d.signed_cents) OVER(ORDER BY d.effective_on,d.commit_sequence,d.event_sequence) AS outstanding
   FROM crest_private.receivable_posted_deltas(requested_business,requested_receivable) d) balances
  WHERE balances.outstanding<0 OR balances.outstanding>original_cents);
$history$;
REVOKE ALL ON FUNCTION crest_private.receivable_posted_deltas(uuid,uuid),
 crest_private.receivable_has_nonnegative_history(uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.receivable_posted_deltas(uuid,uuid),
 crest_private.receivable_has_nonnegative_history(uuid,uuid,bigint) TO crest_finance_account_owner,crest_finance_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.unapplication_funds_mapping(requested_business uuid,on_date date)
RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $mapping$
 SELECT m.id FROM (
  SELECT v.* FROM crest.account_mapping_versions v WHERE v.business_id=requested_business AND v.purpose='customer_funds'
   AND v.effective_from<=on_date ORDER BY v.effective_from DESC LIMIT 1
 ) m JOIN crest.accounts a ON a.business_id=m.business_id AND a.id=m.account_id
 WHERE crest_private.fixed_finance_mapping_matches(m.purpose,a)
  AND (SELECT v.active FROM crest.account_versions v WHERE v.business_id=a.business_id AND v.account_id=a.id ORDER BY v.version DESC LIMIT 1);
$mapping$;
REVOKE ALL ON FUNCTION crest_private.unapplication_funds_mapping(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.unapplication_funds_mapping(uuid,date) TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE FUNCTION crest_private.fictional_unapplication_receipt(u crest.allocation_unapplications,l crest.customer_fund_lots,
 e crest.financial_events, r crest.receivable_items)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',u.business_id,'unapplicationId',u.id,'operationId',u.operation_id,
  'allocationId',u.allocation_id,'eventId',e.id,'fundLotId',l.id,'fundingOriginId',l.origin_id,'parentPartitionId',l.parent_partition_id,
  'customerId',l.customer_id,'receivableId',r.id,'arAccountId',r.account_id,'fundsAccountId',l.account_id,'mappingId',l.mapping_id,
  'effectiveOn',to_char(e.effective_on,'YYYY-MM-DD'),'firstCent',u.first_cent::text,'lastCent',u.last_cent::text,
  'cents',l.original_cents::text,'reason',u.reason);
$snapshot$;
REVOKE ALL ON FUNCTION crest_private.fictional_unapplication_receipt(crest.allocation_unapplications,crest.customer_fund_lots,
 crest.financial_events,crest.receivable_items) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_unapplication_receipt(crest.allocation_unapplications,crest.customer_fund_lots,
 crest.financial_events,crest.receivable_items) TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE POLICY unapplication_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.allocation.unapply');
CREATE POLICY unapplication_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='allocation_unapplications');
CREATE POLICY unapplication_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.allocation.unapply');
CREATE POLICY unapplication_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.allocation.unapply' AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY unapplication_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.allocation.unapply' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.allocation.unapply' AND state='committed');
CREATE POLICY unapplication_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='allocation_unapplications' AND action='unapply' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL);
DO $writer$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['allocation_unapplications','customer_fund_lots','financial_events','atomic_finance_groups','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE POLICY unapplication_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o
     WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
      AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
      AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
      AND o.command_type=''finance.allocation.unapply'' AND o.state=''pending''))',source);
 END LOOP;
END $writer$;

CREATE FUNCTION crest_private.verify_fictional_unapplication(requested_business uuid,requested_event uuid)
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
    AND o.command_type='finance.allocation.unapply' AND o.state='committed' AND o.result=receipt
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

CREATE FUNCTION crest_private.verify_fictional_unapplication_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE source uuid; event_id uuid;
BEGIN
 IF TG_TABLE_NAME='allocation_unapplications' THEN
  source:=NEW.id;
 ELSE
  source:=NEW.unapplication_id;
 END IF;
 SELECT e.id INTO event_id FROM crest.financial_events e WHERE e.business_id=NEW.business_id AND e.unapplication_id=source;
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_fictional_unapplication(NEW.business_id,event_id);
 RETURN NULL;
END $verify$;
RESET ROLE;
ALTER FUNCTION crest_private.verify_fictional_unapplication(uuid,uuid) OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_fictional_unapplication_row() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_fictional_unapplication(uuid,uuid),crest_private.verify_fictional_unapplication_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_fictional_unapplication_row() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER unapplication_complete AFTER INSERT ON crest.allocation_unapplications
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_fictional_unapplication_row();
CREATE CONSTRAINT TRIGGER unapplication_lot_complete AFTER INSERT ON crest.customer_fund_lots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_fictional_unapplication_row();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_fictional_unapplication_row() FROM crest_schema_owner;
-- Replace only the schema 78/79/80 procedures affected by live balances. The
-- old command signature, role, source files and invoice/receipt CSV stay exact.
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.invoice_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
  WHEN 'financial_events' THEN expected_fields||ARRAY['payment_id:uuid','posted_expense_id:uuid','unapplication_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['money_movement_id:uuid','allocation_event_id:uuid','unapplication_id:uuid','fund_lot_id:uuid']
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
 expected_fields:=CASE requested_group
 WHEN 'financial_events' THEN expected_fields||ARRAY['posted_expense_id:uuid','unapplication_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['unapplication_id:uuid','fund_lot_id:uuid']
  ELSE expected_fields END;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECEIPT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.posted_expense_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
 WHEN 'financial_events' THEN expected_fields||ARRAY['unapplication_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['unapplication_id:uuid','fund_lot_id:uuid']
  ELSE expected_fields END;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE FUNCTION crest_private.fictional_posted_report_context_v2(requested_business uuid,through_on date,zone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE event_count bigint; coverage_start date;
BEGIN
 IF through_on<DATE '1900-01-01' OR through_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_DATE_REQUIRED';
 END IF;
 SELECT count(*),min(e.effective_on) INTO event_count,coverage_start FROM crest.financial_events e
 WHERE e.business_id=requested_business AND e.effective_on<=through_on;
 IF EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=requested_business AND e.effective_on<=through_on
  AND e.template NOT IN('P01','P02','P03','P05','P12')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED';
 END IF;
 IF EXISTS(
  SELECT FROM crest.financial_events e LEFT JOIN crest.journal_entries j
   ON j.business_id=e.business_id AND j.event_id=e.id
  LEFT JOIN LATERAL(SELECT count(*) AS n,sum(l.debit_cents::numeric) AS debit,sum(l.credit_cents::numeric) AS credit
   FROM crest.journal_lines l WHERE l.business_id=e.business_id AND l.entry_id=j.id) amounts ON true
  WHERE e.business_id=requested_business AND e.effective_on<=through_on
   AND ((e.zero_effect_reason IS NULL AND (j.id IS NULL OR amounts.n<2 OR amounts.debit IS DISTINCT FROM amounts.credit))
    OR (e.zero_effect_reason IS NOT NULL AND j.id IS NOT NULL))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_LEDGER_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH booked AS (
   SELECT r.id,r.account_id,r.original_cents::numeric+coalesce((
    SELECT sum(d.signed_cents) FROM crest_private.receivable_posted_deltas(r.business_id,r.id) d WHERE d.effective_on<=through_on
   ),0) AS outstanding
   FROM crest.receivable_items r JOIN crest.financial_events issue ON issue.business_id=r.business_id AND issue.invoice_id=r.invoice_id
   WHERE r.business_id=requested_business AND issue.effective_on<=through_on
  ), ledger AS (
   SELECT l.receivable_id,l.account_id,sum(l.debit_cents::numeric-l.credit_cents::numeric) AS balance
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND l.receivable_id IS NOT NULL AND e.effective_on<=through_on
   GROUP BY l.receivable_id,l.account_id
  )
  SELECT FROM booked b FULL JOIN ledger l ON l.receivable_id=b.id AND l.account_id=b.account_id
  WHERE b.id IS NULL OR l.receivable_id IS NULL OR b.outstanding<0 OR b.outstanding IS DISTINCT FROM l.balance
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_RECEIVABLE_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH source AS (
   SELECT m.id,m.event_id,m.account_id,m.signed_cents FROM crest.money_movements m
   JOIN crest.financial_events e ON e.business_id=m.business_id AND e.id=m.event_id
   WHERE m.business_id=requested_business AND e.effective_on<=through_on
  ), ledger AS (
   SELECT l.money_movement_id,j.event_id,l.account_id,(l.debit_cents::numeric-l.credit_cents::numeric) AS net
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND l.money_movement_id IS NOT NULL AND e.effective_on<=through_on
  )
  SELECT FROM source s FULL JOIN ledger l ON l.money_movement_id=s.id AND l.event_id=s.event_id AND l.account_id=s.account_id
  WHERE s.id IS NULL OR l.money_movement_id IS NULL OR s.signed_cents IS DISTINCT FROM l.net
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_MONEY_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH lots AS (
   SELECT l.id,l.account_id,l.original_cents FROM crest.customer_fund_lots l
   JOIN crest.financial_events e ON e.business_id=l.business_id AND e.unapplication_id=l.unapplication_id
   WHERE l.business_id=requested_business AND e.effective_on<=through_on
  ), journal AS (
   SELECT l.fund_lot_id,l.account_id,l.credit_cents-l.debit_cents AS cents
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND e.effective_on<=through_on AND l.fund_lot_id IS NOT NULL
  )
  SELECT FROM lots a FULL JOIN journal j ON j.fund_lot_id=a.id AND j.account_id=a.account_id
  WHERE a.id IS NULL OR j.fund_lot_id IS NULL OR a.original_cents IS DISTINCT FROM j.cents
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_CUSTOMER_FUNDS_CONTROL_FAILED';END IF;
 RETURN jsonb_build_object('schemaVersion',2,'businessId',requested_business,'currency','USD','timeZone',zone,
  'throughOn',to_char(through_on,'YYYY-MM-DD'),'observedAt',
  to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'postedEventCount',event_count::text,'coverageStart',to_char(coverage_start,'YYYY-MM-DD'),
  'coverage',jsonb_build_object('complete',false,'openingBalancesIncluded',false,'reconciliationVerified',false,
   'templates',jsonb_build_array('P01','P02','P03','P05','P12')),
  'controls',jsonb_build_object('ledgerBalanced',true,'receivablesTie',true,'moneyMovementsTie',true,'customerFundsTie',true));
END $report$;
REVOKE ALL ON FUNCTION crest_private.fictional_posted_report_context_v2(uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_posted_report_context_v2(uuid,date,text) TO crest_finance_account_owner;

-- Registered v1 remains exact for its supported dates. A newer posting cannot
-- appear under the older coverage description.
CREATE OR REPLACE FUNCTION crest_private.fictional_posted_report_context(requested_business uuid,through_on date,zone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE result jsonb;
BEGIN
 IF EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=requested_business AND e.effective_on<=through_on AND e.template='P05') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_V2_REQUIRED';
 END IF;
 result:=crest_private.fictional_posted_report_context_v2(requested_business,through_on,zone);
 RETURN result||jsonb_build_object('schemaVersion',1,'coverage',
  (result->'coverage')||jsonb_build_object('templates',jsonb_build_array('P01','P02','P03','P12')),
  'controls',(result->'controls')-'customerFundsTie');
END $report$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.verify_direct_receipt(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; p crest.payments; root crest.funding_origins;
 movement crest.money_movements; money crest.external_money_evidence; journal uuid; channel crest.money_channel_versions;
 operation_result jsonb; expected_receipt jsonb; expected_applications jsonb;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT p FROM crest.payments WHERE business_id=requested_business AND id=e.payment_id;
 SELECT * INTO root FROM crest.funding_origins WHERE business_id=requested_business AND payment_id=p.id;
 SELECT * INTO movement FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO channel FROM crest.money_channel_versions WHERE business_id=requested_business AND id=p.channel_version_id;
 IF movement.evidence_id IS NOT NULL THEN
  SELECT * INTO money FROM crest.external_money_evidence WHERE business_id=requested_business AND id=movement.evidence_id;
 END IF;
 SELECT id INTO journal FROM crest.journal_entries WHERE business_id=requested_business AND event_id=e.id AND entry_sequence=1;
 IF (e.template,e.event_sequence,e.effective_on) IS DISTINCT FROM ('P03'::text,1,p.actual_on)
  OR e.posted_at<p.created_at OR p.actual_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
   JOIN crest_private.operations o ON o.business_id=g.business_id AND o.operation_id=g.operation_id AND o.actor_id=g.created_by
   JOIN crest.accounting_periods ap ON ap.business_id=e.business_id AND ap.id=e.period_id
   JOIN crest_private.audit_events a ON a.business_id=o.business_id AND a.operation_id=o.operation_id AND a.actor_id=o.actor_id
   WHERE g.business_id=e.business_id AND g.id=e.group_id AND g.operation_id=p.operation_id AND g.created_by=p.created_by
    AND g.recovery_epoch=o.recovery_epoch AND o.command_type='finance.receipt.record' AND o.state='committed'
    AND a.entity_kind='payments' AND a.entity_id=p.id AND a.entity_version=1 AND a.action='record'
    AND a.reason=p.confirmation AND a.delta->'after'=o.result AND o.result->>'paymentId'=p.id::text
    AND o.result->>'eventId'=e.id::text AND o.result->>'grossCents'=p.gross_cents::text
    AND e.time_zone=ap.time_zone AND p.actual_on>=ap.starts_on AND p.actual_on<=ap.through_on
    AND e.period_generation=coalesce((SELECT max(l.generation) FROM crest.accounting_period_locks l
     WHERE l.business_id=ap.business_id AND l.period_id=ap.id),0))
  OR root.id IS NULL OR (root.customer_id,root.cents) IS DISTINCT FROM (p.customer_id,p.gross_cents)
  OR movement.id IS NULL OR (movement.account_id,movement.signed_cents) IS DISTINCT FROM (p.account_id,p.gross_cents)
  OR channel.id IS NULL OR channel.account_id<>p.account_id
  OR channel.id IS DISTINCT FROM crest_private.direct_receipt_channel(requested_business,channel.channel_id,p.actual_on,e.time_zone)
  OR movement.evidence_id IS NOT NULL AND (money.provider_namespace,money.external_account_id,money.confirmed_on,money.signed_cents)
   IS DISTINCT FROM (channel.provider_namespace,p.account_id,p.actual_on,p.gross_cents)
  OR p.distinct_reason IS NULL AND EXISTS(SELECT FROM crest.payments earlier
   JOIN crest.money_channel_versions channel_before ON channel_before.business_id=earlier.business_id AND channel_before.id=earlier.channel_version_id
   JOIN crest.financial_events e_before ON e_before.business_id=earlier.business_id AND e_before.payment_id=earlier.id
   JOIN crest.atomic_finance_groups group_before ON group_before.business_id=e_before.business_id AND group_before.id=e_before.group_id
   JOIN crest.atomic_finance_groups current_group ON current_group.business_id=e.business_id AND current_group.id=e.group_id
   JOIN crest.money_movements movement_before ON movement_before.business_id=e_before.business_id AND movement_before.event_id=e_before.id
   WHERE earlier.business_id=p.business_id AND earlier.customer_id=p.customer_id AND earlier.gross_cents=p.gross_cents
    AND earlier.actual_on BETWEEN p.actual_on-1 AND p.actual_on+1 AND channel_before.kind=channel.kind
    AND group_before.commit_sequence<current_group.commit_sequence
    AND (movement.evidence_id IS NULL OR movement_before.evidence_id IS NULL))
  OR journal IS NULL OR EXISTS(SELECT FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id AND j.entry_sequence<>1)
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements t WHERE t.business_id=e.business_id AND t.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_SOURCE_REQUIRED'; END IF;

 IF NOT EXISTS(SELECT FROM crest.funding_partitions x WHERE x.business_id=e.business_id AND x.origin_id=root.id)
  OR EXISTS(SELECT FROM (
    SELECT x.*,lag(x.last_cent::numeric,1,0::numeric) OVER(ORDER BY x.position) AS prior,
     row_number() OVER(ORDER BY x.position) AS ordinal
    FROM crest.funding_partitions x WHERE x.business_id=e.business_id AND x.origin_id=root.id
   ) x LEFT JOIN crest.allocation_events a ON a.business_id=x.business_id AND a.partition_id=x.id
   LEFT JOIN crest.receivable_items r ON r.business_id=a.business_id AND r.id=a.receivable_id
   LEFT JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
   LEFT JOIN crest.financial_events invoice_event ON invoice_event.business_id=i.business_id AND invoice_event.invoice_id=i.id
   LEFT JOIN crest.atomic_finance_groups original_group ON original_group.business_id=invoice_event.business_id
    AND original_group.id=invoice_event.group_id
   LEFT JOIN crest.atomic_finance_groups receipt_group ON receipt_group.business_id=e.business_id AND receipt_group.id=e.group_id
   LEFT JOIN crest.journal_lines line ON line.business_id=a.business_id AND line.allocation_event_id=a.id
   WHERE x.position<>x.ordinal OR x.first_cent::numeric<>x.prior+1 OR x.last_cent>root.cents
    OR (a.event_id,a.cents,r.customer_id) IS DISTINCT FROM (e.id,x.last_cent-x.first_cent+1,p.customer_id)
    OR i.issued_on>p.actual_on OR original_group.id IS NULL OR receipt_group.id IS NULL
    OR original_group.commit_sequence>=receipt_group.commit_sequence
    OR (line.entry_id,line.account_id,line.receivable_id,line.credit_cents) IS DISTINCT FROM (journal,r.account_id,r.id,a.cents)
    OR NOT crest_private.receivable_has_nonnegative_history(r.business_id,r.id,r.original_cents))
  OR (SELECT max(x.last_cent) FROM crest.funding_partitions x WHERE x.business_id=e.business_id AND x.origin_id=root.id)<>root.cents
  OR EXISTS(SELECT FROM crest.allocation_events a JOIN crest.funding_partitions x
    ON x.business_id=a.business_id AND x.id=a.partition_id WHERE a.business_id=e.business_id AND a.event_id=e.id AND x.origin_id<>root.id)
  OR NOT EXISTS(SELECT FROM crest.journal_lines line WHERE line.business_id=e.business_id AND line.entry_id=journal
    AND line.money_movement_id=movement.id AND line.account_id=movement.account_id AND line.debit_cents=movement.signed_cents)
  OR (SELECT count(*) FROM crest.journal_lines line WHERE line.business_id=e.business_id AND line.entry_id=journal)
   <>1+(SELECT count(*) FROM crest.allocation_events a WHERE a.business_id=e.business_id AND a.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_APPLICATION_EFFECT_REQUIRED';END IF;
 SELECT o.result INTO STRICT operation_result FROM crest_private.operations o
 WHERE o.business_id=p.business_id AND o.operation_id=p.operation_id AND o.actor_id=p.created_by;
 SELECT jsonb_agg(jsonb_build_object('id',a.id,'receivableId',a.receivable_id,
  'fundingPartitionId',x.id,'cents',a.cents::text) ORDER BY x.position) INTO expected_applications
 FROM crest.allocation_events a JOIN crest.funding_partitions x ON x.business_id=a.business_id AND x.id=a.partition_id
 WHERE a.business_id=e.business_id AND a.event_id=e.id;
 expected_receipt:=jsonb_build_object('schemaVersion',1,'businessId',p.business_id,'paymentId',p.id,'eventId',e.id,
  'customerId',p.customer_id,'channelVersionId',p.channel_version_id,'accountId',p.account_id,'actualOn',to_char(p.actual_on,'YYYY-MM-DD'),
  'grossCents',p.gross_cents::text,'fundingOriginId',root.id,'moneyMovementId',movement.id,'externalEvidenceId',movement.evidence_id,
  'applications',expected_applications);
 IF operation_result IS DISTINCT FROM expected_receipt THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_SOURCE_REQUIRED';
 END IF;
END $verify$;

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
  WHEN 'P05' THEN PERFORM crest_private.verify_fictional_unapplication(saved.business_id,saved.id);
  WHEN 'P12' THEN PERFORM crest_private.verify_same_day_expense(saved.business_id,saved.id);
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_TEMPLATE_NOT_SUPPORTED';
 END CASE;
END $posting$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE OR REPLACE FUNCTION crest_commands.record_direct_fictional_receipt(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_payment uuid,requested_customer uuid,requested_channel uuid,
 expected_channel_version bigint,actual_on date,gross_cents bigint,confirmation text,distinct_reason text,external_identity jsonb,
 applications jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $record$
DECLARE
 auth jsonb; digest text; saved record; channel crest.money_channel_versions; period record; allocation record;
 receivable crest.receivable_items; group_id uuid; event_id uuid; journal_id uuid; origin_id uuid; partition_id uuid;
 application_id uuid; evidence_id uuid; movement_id uuid; claimed uuid; position integer:=0; used bigint:=0;
 outstanding numeric; receipt jsonb; output_applications jsonb:='[]'::jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_payment IS NULL OR requested_customer IS NULL OR requested_channel IS NULL
  OR expected_channel_version IS NULL OR expected_channel_version<1
  OR actual_on IS NULL OR actual_on<DATE '0001-01-01' OR actual_on>DATE '9999-12-31'
  OR gross_cents IS NULL OR gross_cents<=0 OR confirmation IS NULL OR char_length(confirmation) NOT BETWEEN 1 AND 1000
  OR confirmation<>btrim(confirmation) OR confirmation~'[[:cntrl:]]'
  OR (distinct_reason IS NOT NULL AND (char_length(distinct_reason) NOT BETWEEN 1 AND 1000
    OR distinct_reason<>btrim(distinct_reason) OR distinct_reason~'[[:cntrl:]]'))
  OR jsonb_typeof(applications) IS DISTINCT FROM 'object' OR octet_length(applications::text)>20000
  OR (external_identity IS NOT NULL AND (jsonb_typeof(external_identity) IS DISTINCT FROM 'object'
    OR NOT external_identity?&ARRAY['namespace','id','rawReference']
    OR external_identity-ARRAY['namespace','id','rawReference']<>'{}'::jsonb
    OR jsonb_typeof(external_identity->'namespace') IS DISTINCT FROM 'string'
    OR jsonb_typeof(external_identity->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(external_identity->'rawReference') IS DISTINCT FROM 'string'
    OR external_identity->>'namespace'!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
    OR char_length(external_identity->>'id') NOT BETWEEN 1 AND 200
    OR external_identity->>'id'<>btrim(external_identity->>'id') OR external_identity->>'id'~'[[:cntrl:]]'
    OR char_length(external_identity->>'rawReference') NOT BETWEEN 1 AND 1000)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_INPUT_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM jsonb_each(applications)) NOT BETWEEN 1 AND 180
  OR EXISTS(SELECT FROM jsonb_each(applications) a
   WHERE a.key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(a.value) IS DISTINCT FROM 'string' OR a.value#>>'{}'!~'^[1-9][0-9]{0,18}$')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_INPUT_REQUIRED';END IF;
 IF (SELECT sum((a.value#>>'{}')::numeric) FROM jsonb_each(applications) a)<>gross_cents THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_FULL_ALLOCATION_REQUIRED';
 END IF;

 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.receipt.record',1,requested_business,expected_actor,
  expected_epoch,requested_payment,requested_customer,requested_channel,expected_channel_version,actual_on,gross_cents::text,
  confirmation,distinct_reason,external_identity,applications)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.receipt.record',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.receipt.record' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF actual_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_DATE_REQUIRED';
 END IF;
 SELECT * INTO channel FROM crest.money_channel_versions v WHERE v.business_id=requested_business
  AND v.id=crest_private.direct_receipt_channel(requested_business,requested_channel,actual_on,auth->>'timezone');
 IF NOT FOUND OR channel.version<>expected_channel_version THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_VERIFIED_CHANNEL_REQUIRED';
 END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,actual_on,auth->>'timezone');

 IF EXISTS(SELECT FROM crest.payments p WHERE p.business_id=requested_business AND p.id=requested_payment) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='DIRECT_RECEIPT_ALREADY_RECORDED';
 END IF;
 IF external_identity IS NOT NULL AND EXISTS(SELECT FROM crest.external_money_evidence ev
  WHERE ev.business_id=requested_business AND ev.provider_namespace=channel.provider_namespace
   AND ev.external_account_id=channel.account_id AND ev.id_namespace=external_identity->>'namespace'
   AND ev.external_id=external_identity->>'id') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='DIRECT_RECEIPT_EXTERNAL_ID_ALREADY_RECORDED';
 END IF;
 -- An ID on only one side cannot establish that two similar payments differ.
 IF distinct_reason IS NULL AND EXISTS(SELECT FROM crest.payments p
   JOIN crest.money_channel_versions v ON v.business_id=p.business_id AND v.id=p.channel_version_id
   JOIN crest.financial_events e ON e.business_id=p.business_id AND e.payment_id=p.id
   JOIN crest.money_movements m ON m.business_id=e.business_id AND m.event_id=e.id
   WHERE p.business_id=requested_business AND p.customer_id=requested_customer
    AND p.gross_cents=record_direct_fictional_receipt.gross_cents
    AND p.actual_on BETWEEN record_direct_fictional_receipt.actual_on-1 AND record_direct_fictional_receipt.actual_on+1
    AND v.kind=channel.kind AND (external_identity IS NULL OR m.evidence_id IS NULL))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_DUPLICATE_REVIEW_REQUIRED';END IF;

 FOR allocation IN SELECT a.key::uuid AS receivable_id,(a.value#>>'{}')::bigint AS cents FROM jsonb_each(applications) a ORDER BY a.key LOOP
  SELECT r.* INTO receivable FROM crest.receivable_items r JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
   WHERE r.business_id=requested_business AND r.id=allocation.receivable_id AND r.customer_id=requested_customer
    AND i.issued_on<=record_direct_fictional_receipt.actual_on;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_RECEIVABLE_REQUIRED';END IF;
  SELECT min(remaining) INTO outstanding FROM (
   SELECT receivable.original_cents+coalesce(sum(d.signed_cents)
    FILTER(WHERE d.effective_on<=record_direct_fictional_receipt.actual_on),0) AS remaining
   FROM crest_private.receivable_posted_deltas(requested_business,receivable.id) d
   UNION ALL
   SELECT receivable.original_cents+dated.running FROM (
    SELECT d.effective_on,sum(d.signed_cents) OVER(ORDER BY d.effective_on,d.commit_sequence,d.event_sequence) AS running
    FROM crest_private.receivable_posted_deltas(requested_business,receivable.id) d
   ) dated WHERE dated.effective_on>record_direct_fictional_receipt.actual_on
  ) capacity;
  IF allocation.cents>outstanding THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_ALLOCATION_EXCEEDS_BALANCE';
  END IF;
 END LOOP;

 INSERT INTO crest.payments(id,business_id,customer_id,channel_version_id,account_id,actual_on,gross_cents,confirmation,distinct_reason,operation_id,created_by)
 VALUES(requested_payment,requested_business,requested_customer,channel.id,channel.account_id,actual_on,gross_cents,
  confirmation,distinct_reason,requested_operation,expected_actor);
 IF external_identity IS NOT NULL THEN
  INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
   normalization_rule,confirmed_on,signed_cents,currency)
  VALUES(requested_business,channel.provider_namespace,channel.account_id,external_identity->>'namespace',external_identity->>'id',
   external_identity->>'rawReference','exact_case_v1',actual_on,gross_cents,'USD') RETURNING id INTO evidence_id;
 END IF;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,payment_id,period_id,period_generation,effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,requested_payment,period.period_id,period.generation,actual_on,auth->>'timezone','P03',1)
 RETURNING id INTO event_id;
 INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
 VALUES(requested_business,event_id,channel.account_id,evidence_id,gross_cents) RETURNING id INTO movement_id;
 INSERT INTO crest.funding_origins(business_id,payment_id,customer_id,cents,currency)
 VALUES(requested_business,requested_payment,requested_customer,gross_cents,'USD') RETURNING id INTO origin_id;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,event_id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,account_id,money_movement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,channel.account_id,movement_id,'receipt_money',gross_cents,0);
 FOR allocation IN SELECT a.key::uuid AS receivable_id,(a.value#>>'{}')::bigint AS cents FROM jsonb_each(applications) a ORDER BY a.key LOOP
  position:=position+1;
  INSERT INTO crest.funding_partitions(business_id,origin_id,position,first_cent,last_cent)
  VALUES(requested_business,origin_id,position,used+1,used+allocation.cents) RETURNING id INTO partition_id;
  used:=used+allocation.cents;
  INSERT INTO crest.allocation_events(business_id,event_id,partition_id,receivable_id,cents)
  VALUES(requested_business,event_id,partition_id,allocation.receivable_id,allocation.cents) RETURNING id INTO application_id;
  INSERT INTO crest.journal_lines(business_id,entry_id,receivable_id,account_id,allocation_event_id,purpose,debit_cents,credit_cents)
  SELECT requested_business,journal_id,r.id,r.account_id,application_id,'receipt_ar',0,allocation.cents
  FROM crest.receivable_items r WHERE r.business_id=requested_business AND r.id=allocation.receivable_id;
  output_applications:=output_applications||jsonb_build_object('id',application_id,'receivableId',allocation.receivable_id,
   'fundingPartitionId',partition_id,'cents',allocation.cents::text);
 END LOOP;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'paymentId',requested_payment,'eventId',event_id,
  'customerId',requested_customer,'channelVersionId',channel.id,'accountId',channel.account_id,'actualOn',to_char(actual_on,'YYYY-MM-DD'),
  'grossCents',gross_cents::text,'fundingOriginId',origin_id,'moneyMovementId',movement_id,'externalEvidenceId',evidence_id,
  'applications',output_applications);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'payments',requested_payment,1,'record',confirmation,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $record$;

CREATE OR REPLACE FUNCTION crest_commands.read_direct_fictional_receipt_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_date date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; channels jsonb; receivables jsonb; selected date; today date;
BEGIN
 IF requested_customer IS NULL OR (requested_date IS NOT NULL AND
  (requested_date<DATE '0001-01-01' OR requested_date>DATE '9999-12-31')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 today:=(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date;
 selected:=coalesce(requested_date,today);
 IF selected>today THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF NOT EXISTS(SELECT FROM crest.customers c WHERE c.business_id=requested_business AND c.id=requested_customer) THEN
  RETURN jsonb_build_object('state','absent');
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',c.channel_id,'channelVersionId',c.id,'version',c.version::text,
  'accountId',c.account_id,'label',c.label,'kind',c.kind) ORDER BY c.label,c.id),'[]'::jsonb)
 INTO channels FROM (
  SELECT v.* FROM crest.money_channel_versions v WHERE v.business_id=requested_business
   AND v.id=crest_private.direct_receipt_channel(requested_business,v.channel_id,selected,auth->>'timezone')
  ORDER BY v.label,v.id LIMIT 181
 ) c;
 SELECT coalesce(jsonb_agg(jsonb_build_object('receivableId',x.id,'invoiceId',x.invoice_id,'invoiceNumber',x.invoice_number,
  'issuedOn',to_char(x.issued_on,'YYYY-MM-DD'),'dueOn',to_char(x.due_on,'YYYY-MM-DD'),
  'remainingCents',x.remaining::text) ORDER BY x.due_on,x.id),'[]'::jsonb)
 INTO receivables FROM (
  SELECT available.* FROM (
  SELECT r.id,r.invoice_id,r.due_on,i.invoice_number,i.issued_on,r.original_cents+coalesce(
   (SELECT sum(d.signed_cents) FROM crest_private.receivable_posted_deltas(r.business_id,r.id) d WHERE d.effective_on<=selected),0) AS remaining
  FROM crest.receivable_items r JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
  WHERE r.business_id=requested_business AND r.customer_id=requested_customer AND i.issued_on<=selected
  ) available WHERE available.remaining>0 ORDER BY available.due_on,available.id LIMIT 181
 ) x;
 IF jsonb_array_length(channels)>180 OR jsonb_array_length(receivables)>180 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='DIRECT_RECEIPT_OPTIONS_LIMIT';
 END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'actualOn',to_char(selected,'YYYY-MM-DD'),'channels',channels,'receivables',receivables);
END $options$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.unapply_fictional_payment_allocation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_unapplication uuid,requested_allocation uuid,requested_customer uuid,
 expected_funds_mapping uuid,reviewed_on date,requested_first_cent bigint,requested_last_cent bigint,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; saved record; a crest.allocation_events; source_event crest.financial_events;
 r crest.receivable_items; parent crest.funding_partitions; root crest.funding_origins; m crest.account_mapping_versions;
 u crest.allocation_unapplications; l crest.customer_fund_lots; e crest.financial_events; period record;
 claimed uuid; group_id uuid; journal_id uuid; cents bigint; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_unapplication IS NULL OR requested_allocation IS NULL OR requested_customer IS NULL
  OR expected_funds_mapping IS NULL OR reviewed_on IS NULL OR reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31'
  OR requested_first_cent IS NULL OR requested_last_cent IS NULL OR requested_first_cent<1 OR requested_last_cent<requested_first_cent
  OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR review_reason<>btrim(review_reason)
  OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNAPPLICATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.allocation.unapply',1,requested_business,expected_actor,expected_epoch,
  requested_unapplication,requested_allocation,requested_customer,expected_funds_mapping,reviewed_on,requested_first_cent::text,
  requested_last_cent::text,review_reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.allocation.unapply',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.allocation.unapply' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO a FROM crest.allocation_events WHERE business_id=requested_business AND id=requested_allocation;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_ALLOCATION_REQUIRED';END IF;
 SELECT * INTO STRICT source_event FROM crest.financial_events WHERE business_id=requested_business AND id=a.event_id;
 SELECT * INTO STRICT r FROM crest.receivable_items WHERE business_id=requested_business AND id=a.receivable_id;
 SELECT * INTO STRICT parent FROM crest.funding_partitions WHERE business_id=requested_business AND id=a.partition_id;
 SELECT * INTO STRICT root FROM crest.funding_origins WHERE business_id=requested_business AND id=parent.origin_id;
 IF source_event.template<>'P03' OR r.customer_id<>requested_customer OR root.customer_id<>requested_customer THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_ALLOCATION_REQUIRED';
 END IF;
 IF reviewed_on<source_event.effective_on OR reviewed_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_DATE_REQUIRED';
 END IF;
 IF requested_first_cent<parent.first_cent OR requested_last_cent>parent.last_cent OR EXISTS(
   SELECT FROM crest.allocation_unapplications taken WHERE taken.business_id=requested_business AND taken.allocation_id=a.id
    AND taken.first_cent<=requested_last_cent AND taken.last_cent>=requested_first_cent) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_RANGE_UNAVAILABLE';
 END IF;
 IF EXISTS(SELECT FROM crest.allocation_unapplications x WHERE x.business_id=requested_business AND x.id=requested_unapplication) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='UNAPPLICATION_ALREADY_RECORDED';
 END IF;
 SELECT * INTO m FROM crest.account_mapping_versions v WHERE v.business_id=requested_business AND v.id=expected_funds_mapping
  AND v.id=crest_private.unapplication_funds_mapping(requested_business,reviewed_on);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_FUNDS_MAPPING_REQUIRED';END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,reviewed_on,auth->>'timezone');
 cents:=requested_last_cent-requested_first_cent+1;
 INSERT INTO crest.allocation_unapplications(id,business_id,allocation_id,first_cent,last_cent,reason,operation_id,created_by)
 VALUES(requested_unapplication,requested_business,a.id,requested_first_cent,requested_last_cent,review_reason,requested_operation,expected_actor)
 RETURNING * INTO u;
 INSERT INTO crest.customer_fund_lots(business_id,unapplication_id,origin_id,parent_partition_id,customer_id,account_id,mapping_id,original_cents)
 VALUES(requested_business,u.id,root.id,parent.id,r.customer_id,m.account_id,m.id,cents) RETURNING * INTO l;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,unapplication_id,period_id,period_generation,effective_on,time_zone,
  template,template_version)
 VALUES(requested_business,group_id,1,u.id,period.period_id,period.generation,reviewed_on,auth->>'timezone','P05',1) RETURNING * INTO e;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,e.id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,unapplication_id,receivable_id,account_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,u.id,r.id,r.account_id,'unapply_ar',cents,0);
 INSERT INTO crest.journal_lines(business_id,entry_id,unapplication_id,fund_lot_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,u.id,l.id,l.account_id,l.mapping_id,'unapply_funds',0,cents);
 receipt:=crest_private.fictional_unapplication_receipt(u,l,e,r);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'allocation_unapplications',u.id,1,'unapply',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.unapply_fictional_payment_allocation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.unapply_fictional_payment_allocation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.unapply_fictional_payment_allocation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,text) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.fictional_journal_body_v2(requested_business uuid,through_on date,requested_account uuid,after_line uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE anchor record; body jsonb;
BEGIN
 IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_PAGE_REQUIRED';
 END IF;
 IF requested_account IS NOT NULL AND NOT EXISTS(
  SELECT FROM crest.accounts a WHERE a.business_id=requested_business AND a.id=requested_account) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_ACCOUNT_REQUIRED';
 END IF;
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,j.entry_sequence,l.id INTO anchor
 FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
 JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
 JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
 WHERE l.business_id=requested_business AND l.id=after_line AND e.effective_on<=through_on
  AND (requested_account IS NULL OR l.account_id=requested_account);
 IF after_line IS NOT NULL AND NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_PAGE_REQUIRED';
 END IF;
 WITH eligible AS (
  SELECT l.id,l.account_id,l.debit_cents,l.credit_cents,l.purpose,j.id AS entry_id,j.entry_sequence,e.id AS event_id,
   e.effective_on,e.event_sequence,e.template,e.invoice_id,e.payment_id,e.posted_expense_id,e.unapplication_id,l.fund_lot_id,g.commit_sequence,g.operation_id,
   sum(l.debit_cents::numeric-l.credit_cents::numeric) OVER(PARTITION BY l.account_id ORDER BY
    e.effective_on,g.commit_sequence,e.event_sequence,j.entry_sequence,l.id ROWS UNBOUNDED PRECEDING) AS running
  FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
  JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
  JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
  WHERE l.business_id=requested_business AND e.effective_on<=through_on
   AND (requested_account IS NULL OR l.account_id=requested_account)
 ), candidates AS MATERIALIZED (
  SELECT r.*,a.code,v.name FROM eligible r JOIN crest.accounts a ON a.business_id=requested_business AND a.id=r.account_id
  JOIN LATERAL(SELECT av.name FROM crest.account_versions av WHERE av.business_id=a.business_id AND av.account_id=a.id
   ORDER BY av.version DESC LIMIT 1) v ON true
  WHERE after_line IS NULL OR (r.effective_on,r.commit_sequence,r.event_sequence,r.entry_sequence,r.id)>
   (anchor.effective_on,anchor.commit_sequence,anchor.event_sequence,anchor.entry_sequence,anchor.id)
  ORDER BY r.effective_on,r.commit_sequence,r.event_sequence,r.entry_sequence,r.id LIMIT page_limit+1
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY effective_on,commit_sequence,event_sequence,entry_sequence,id LIMIT page_limit
 )
 SELECT jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('lineId',p.id,'eventId',p.event_id,'entryId',p.entry_id,
  'effectiveOn',to_char(p.effective_on,'YYYY-MM-DD'),'commitSequence',p.commit_sequence::text,'eventSequence',p.event_sequence::text,
  'entrySequence',p.entry_sequence::text,'template',p.template,'purpose',p.purpose,'accountId',p.account_id,'code',p.code,'name',p.name,
  'debitCents',p.debit_cents::text,'creditCents',p.credit_cents::text,'runningBalanceCents',p.running::text,
  'invoiceId',p.invoice_id,'paymentId',p.payment_id,'postedExpenseId',p.posted_expense_id,'unapplicationId',p.unapplication_id,'fundLotId',p.fund_lot_id,'operationId',p.operation_id)
  ORDER BY p.effective_on,p.commit_sequence,p.event_sequence,p.entry_sequence,p.id),'[]'::jsonb),
  'hasMore',(SELECT count(*)>page_limit FROM candidates),
  'nextAfterLineId',CASE WHEN (SELECT count(*)>page_limit FROM candidates) THEN
   (SELECT id FROM page ORDER BY effective_on DESC,commit_sequence DESC,event_sequence DESC,entry_sequence DESC,id DESC LIMIT 1) END)
 INTO body FROM page p;
 RETURN body;
END $report$;
REVOKE ALL ON FUNCTION crest_private.fictional_journal_body_v2(uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_journal_body_v2(uuid,date,uuid,uuid,integer) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.read_fictional_trial_balance_v2(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_posted_report_context_v2(requested_business,selected,zone)||
  crest_private.fictional_trial_balance_body(requested_business,selected) INTO result;
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.read_fictional_journal_v2(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date,
 requested_account uuid,after_line uuid,page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_posted_report_context_v2(requested_business,selected,zone)||
  crest_private.fictional_journal_body_v2(requested_business,selected,requested_account,after_line,page_limit) INTO result;
 RETURN result;
END $read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_trial_balance_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_journal_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_trial_balance_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date),
 crest_commands.read_fictional_journal_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_trial_balance_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date),
 crest_commands.read_fictional_journal_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-allocation-unapply.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-allocation-unapply-operations.sql
-- Held P05 exact operation lookup and explicitly reviewed absent retirement.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY unapplication_retirement_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.allocation.retire_unapplication');
CREATE POLICY unapplication_retirement_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.allocation.retire_unapplication'
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY unapplication_retirement_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.allocation.retire_unapplication' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.allocation.retire_unapplication' AND state='committed');
CREATE POLICY unapplication_retirement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire'
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.allocation.retire_unapplication' AND o.state='committed'));
CREATE FUNCTION crest_commands.lookup_fictional_allocation_unapplication(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_unapplication uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_unapplication IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNAPPLICATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT o.id,o.command_type,o.recovery_epoch,o.result,o.payload_hash,p.id AS unapplication_id INTO saved
 FROM crest_private.operations o LEFT JOIN crest.allocation_unapplications p ON p.business_id=o.business_id AND p.operation_id=o.operation_id
 WHERE o.business_id=requested_business AND o.operation_id=original_operation AND o.actor_id=expected_actor
  AND o.command_type IN('finance.allocation.unapply','finance.allocation.retire_unapplication') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.command_type='finance.allocation.retire_unapplication' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'unapplicationId') IS DISTINCT FROM (original_epoch::text,original_unapplication::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.delta INTO audit_delta FROM crest_private.audit_events a
  WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
   AND a.entity_kind='operations' AND a.entity_id=saved.id AND a.action='retire' AND a.reason=saved.result->>'reason';
  IF saved.unapplication_id IS NOT NULL OR saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_RETIREMENT_AUDIT_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF (saved.recovery_epoch,saved.unapplication_id) IS DISTINCT FROM (original_epoch,original_unapplication) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY unapplication_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.allocation.retire_unapplication' AND o.state='pending'));

CREATE FUNCTION crest_commands.retire_fictional_allocation_unapplication(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_unapplication uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR
  review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNAPPLICATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_allocation_unapplication($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'unapplicationId',original_unapplication,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.allocation.retire_unapplication',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_allocation_unapplication($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
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
ALTER FUNCTION crest_commands.retire_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_allocation_unapplication_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_allocation uuid,reviewed_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; selected date; today date; source record; ranges jsonb; mapping uuid; open_period boolean;
BEGIN
 IF requested_customer IS NULL OR requested_allocation IS NULL OR
  (reviewed_on IS NOT NULL AND (reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNAPPLICATION_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 today:=(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date;
 selected:=coalesce(reviewed_on,today);
 IF selected>today THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT a.id,e.effective_on,e.payment_id,r.id AS receivable_id,i.invoice_number,
  p.first_cent,p.last_cent INTO source
 FROM crest.allocation_events a
 JOIN crest.financial_events e ON e.business_id=a.business_id AND e.id=a.event_id AND e.template='P03'
 JOIN crest.receivable_items r ON r.business_id=a.business_id AND r.id=a.receivable_id
 JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
 JOIN crest.funding_partitions p ON p.business_id=a.business_id AND p.id=a.partition_id
 JOIN crest.funding_origins f ON f.business_id=p.business_id AND f.id=p.origin_id
 WHERE a.business_id=requested_business AND a.id=requested_allocation AND r.customer_id=requested_customer
  AND f.customer_id=requested_customer;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF selected<source.effective_on THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_DATE_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('firstCent',gap.first_cent::text,'lastCent',gap.last_cent::text)
  ORDER BY gap.first_cent),'[]'::jsonb) INTO ranges
 FROM (
  SELECT spans.previous_end+1 AS first_cent,spans.next_start-1 AS last_cent
  FROM (
   SELECT lag(boundary.last_cent,1,source.first_cent::numeric-1) OVER(ORDER BY boundary.first_cent) AS previous_end,
    boundary.first_cent AS next_start
   FROM (
    SELECT u.first_cent::numeric,u.last_cent::numeric FROM crest.allocation_unapplications u
    WHERE u.business_id=requested_business AND u.allocation_id=source.id
    UNION ALL SELECT source.last_cent::numeric+1,NULL::numeric
   ) boundary
  ) spans WHERE spans.previous_end+1<spans.next_start ORDER BY spans.previous_end LIMIT 181
 ) gap;
 IF jsonb_array_length(ranges)>180 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='UNAPPLICATION_OPTIONS_LIMIT';END IF;
 mapping:=crest_private.unapplication_funds_mapping(requested_business,selected);
 SELECT EXISTS(SELECT FROM crest.accounting_periods a
  LEFT JOIN LATERAL (SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=a.business_id AND h.period_id=a.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE a.business_id=requested_business AND a.time_zone=auth->>'timezone'
   AND selected>=a.starts_on AND selected<=a.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('state','review','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'allocationId',source.id,'paymentId',source.payment_id,'receivableId',source.receivable_id,'invoiceNumber',source.invoice_number,
  'paidOn',to_char(source.effective_on,'YYYY-MM-DD'),'effectiveOn',to_char(selected,'YYYY-MM-DD'),'fundsMappingId',mapping,
  'openPeriod',open_period,'availableRanges',ranges);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_allocation_unapplication_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_allocation_unapplication_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_allocation_unapplication_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.list_fictional_invoice_payment_allocations(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_invoice uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE rows jsonb;
BEGIN
 IF requested_customer IS NULL OR requested_invoice IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNAPPLICATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF NOT EXISTS(SELECT FROM crest.receivable_items r WHERE r.business_id=requested_business
   AND r.customer_id=requested_customer AND r.invoice_id=requested_invoice) THEN
  RETURN jsonb_build_object('state','absent');
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('allocationId',r.id,'paymentId',r.payment_id,
  'paidOn',to_char(r.effective_on,'YYYY-MM-DD'),'appliedCents',r.cents::text,'availableCents',r.available::text)
  ORDER BY r.effective_on DESC,r.id),'[]'::jsonb) INTO rows
 FROM (
  SELECT a.id,e.payment_id,e.effective_on,a.cents,a.cents-coalesce((SELECT sum(u.last_cent-u.first_cent+1)
   FROM crest.allocation_unapplications u WHERE u.business_id=a.business_id AND u.allocation_id=a.id),0) AS available
  FROM crest.receivable_items item
  JOIN crest.allocation_events a ON a.business_id=item.business_id AND a.receivable_id=item.id
  JOIN crest.financial_events e ON e.business_id=a.business_id AND e.id=a.event_id AND e.template='P03'
  WHERE item.business_id=requested_business AND item.customer_id=requested_customer AND item.invoice_id=requested_invoice
  ORDER BY e.effective_on DESC,a.id LIMIT 181
 ) r;
 IF jsonb_array_length(rows)>180 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='UNAPPLICATION_OPTIONS_LIMIT';END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,
  'customerId',requested_customer,'invoiceId',requested_invoice,'allocations',rows);
END $list$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_fictional_invoice_payment_allocations(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.list_fictional_invoice_payment_allocations(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_fictional_invoice_payment_allocations(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-allocation-unapply-operations.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-allocation-unapply-source.sql
-- Held P05 source scoped to original reclassification and its child funds lot.
DO $review$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='crest_unapplication_export_owner') OR
  NOT EXISTS(SELECT FROM pg_roles WHERE rolname='crest_export'
   AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('crest_commands.business_history_export_context(uuid)')
   AND proowner='crest_export_owner'::regrole AND prosecdef)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNAPPLICATION_SOURCE_AUTHORITY_REVIEW_REQUIRED';END IF;
END $review$;
CREATE ROLE crest_unapplication_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_unapplication_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_commands,crest_private TO crest_unapplication_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid),
 crest_commands.business_configuration_export_context(uuid) TO crest_unapplication_export_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.unapplication_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('allocation_unapplications', ARRAY[
  'id:uuid', 'business_id:uuid', 'allocation_id:uuid', 'first_cent:bigint',
  'last_cent:bigint', 'reason:text', 'operation_id:uuid', 'created_by:uuid',
  'created_at:timestamp with time zone'
 ]),
 ('customer_fund_lots', ARRAY[
  'id:uuid', 'business_id:uuid', 'unapplication_id:uuid', 'origin_id:uuid',
  'parent_partition_id:uuid', 'customer_id:uuid', 'account_id:uuid', 'mapping_id:uuid',
  'original_cents:bigint'
 ]),
 ('atomic_finance_groups', ARRAY[
  'id:uuid', 'business_id:uuid', 'commit_sequence:bigint', 'recovery_epoch:uuid',
  'created_by:uuid', 'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('financial_events', ARRAY[
  'id:uuid', 'business_id:uuid', 'group_id:uuid', 'event_sequence:integer',
  'invoice_id:uuid', 'period_id:uuid', 'period_generation:bigint', 'reopened_generation:bigint',
  'effective_on:date', 'time_zone:text', 'template:text', 'template_version:integer',
  'zero_effect_reason:text', 'posted_at:timestamp with time zone', 'payment_id:uuid', 'posted_expense_id:uuid',
  'unapplication_id:uuid'
 ]),
 ('journal_entries', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'entry_sequence:integer'
 ]),
 ('journal_lines', ARRAY[
  'id:uuid', 'business_id:uuid', 'entry_id:uuid', 'invoice_item_id:uuid',
  'receivable_id:uuid', 'account_id:uuid', 'fixed_mapping_id:uuid', 'tax_payable_movement_id:uuid',
  'purpose:text', 'debit_cents:bigint', 'credit_cents:bigint', 'money_movement_id:uuid',
  'allocation_event_id:uuid', 'unapplication_id:uuid', 'fund_lot_id:uuid'
 ]);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.unapplication_source_dictionary() FROM PUBLIC;

CREATE FUNCTION crest_private.unapplication_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNAPPLICATION_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
REVOKE ALL ON FUNCTION crest_private.unapplication_source_check_group(text,text[]) FROM PUBLIC;

CREATE FUNCTION crest_private.unapplication_source_token(requested_business uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $token$
DECLARE snapshot_value text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_UNAPPLICATION_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNAPPLICATION_SOURCE_SCOPE_REQUIRED';END IF;
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_UNAPPLICATION_SOURCE_LIMIT';END IF;
 RETURN encode(sha256(convert_to(jsonb_build_array('crest.allocation.unapplication.sources/1',requested_business,
  pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
END $token$;
REVOKE ALL ON FUNCTION crest_private.unapplication_source_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.unapplication_source_dictionary(),
 crest_private.unapplication_source_check_group(text,text[]),crest_private.unapplication_source_token(uuid) TO crest_unapplication_export_owner;

DO $grants$
DECLARE source record; columns text;
BEGIN
 FOR source IN SELECT * FROM crest_private.unapplication_source_dictionary() LOOP
  PERFORM crest_private.unapplication_source_check_group(source.group_name,source.fields);
  IF has_any_column_privilege('crest_export',format('crest.%I',source.group_name),'SELECT,INSERT,UPDATE,REFERENCES')
   OR has_table_privilege('crest_export',format('crest.%I',source.group_name),'DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNAPPLICATION_SOURCE_AUTHORITY_REVIEW_REQUIRED';
  END IF;
  SELECT string_agg(format('%I',split_part(field,':',1)),',') INTO columns FROM unnest(source.fields) AS field;
  EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_unapplication_export_owner',columns,source.group_name);
 END LOOP;
END $grants$;
CREATE POLICY unapplication_source_export_read ON crest.allocation_unapplications FOR SELECT TO crest_unapplication_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY unapplication_source_export_read ON crest.customer_fund_lots FOR SELECT TO crest_unapplication_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY unapplication_source_export_read ON crest.financial_events FOR SELECT TO crest_unapplication_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND template='P05');
CREATE POLICY unapplication_source_export_read ON crest.atomic_finance_groups FOR SELECT TO crest_unapplication_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=atomic_finance_groups.business_id AND e.group_id=atomic_finance_groups.id));
CREATE POLICY unapplication_source_export_read ON crest.journal_entries FOR SELECT TO crest_unapplication_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=journal_entries.business_id AND e.id=journal_entries.event_id));
CREATE POLICY unapplication_source_export_read ON crest.journal_lines FOR SELECT TO crest_unapplication_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.journal_entries j WHERE j.business_id=journal_lines.business_id AND j.id=journal_lines.entry_id));

CREATE FUNCTION crest_commands.unapplication_source_snapshot_context(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.unapplication_source_token(requested_business);
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
 RETURN jsonb_build_object('schemaVersion',1,'scope','allocation_unapplication_sources','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.unapplication_source_snapshot_page(requested_business uuid,expected_snapshot text,
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
GRANT CREATE ON SCHEMA crest_commands TO crest_unapplication_export_owner;
ALTER FUNCTION crest_commands.unapplication_source_snapshot_context(uuid) OWNER TO crest_unapplication_export_owner;
ALTER FUNCTION crest_commands.unapplication_source_snapshot_page(uuid,text,text,uuid,integer) OWNER TO crest_unapplication_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_unapplication_export_owner;
REVOKE ALL ON FUNCTION crest_commands.unapplication_source_snapshot_context(uuid),
 crest_commands.unapplication_source_snapshot_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.unapplication_source_snapshot_context(uuid),
 crest_commands.unapplication_source_snapshot_page(uuid,text,text,uuid,integer) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-allocation-unapply-source.sql
