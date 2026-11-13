-- Held direct P03 against already issued fictional invoices. Existing invoice
-- records and their registered export projection stay exact.
-- The direct P03 slice uses the shared finance order and journal. The exact
-- invoice-only profile continues to see only invoice-owned shared rows.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.external_money_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 provider_namespace text NOT NULL CHECK(provider_namespace~'^[a-z][a-z0-9_-]{0,63}$'),
 external_account_id uuid NOT NULL,
 id_namespace text NOT NULL CHECK(id_namespace~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'),
 external_id text NOT NULL CHECK(char_length(external_id)>=1 AND char_length(external_id)<=200
  AND external_id=btrim(external_id) AND external_id!~'[[:cntrl:]]'),
 raw_reference text NOT NULL CHECK(char_length(raw_reference)>=1 AND char_length(raw_reference)<=1000),
 normalization_rule text NOT NULL CHECK(normalization_rule='exact_case_v1'),
 confirmed_on date NOT NULL,
 signed_cents bigint NOT NULL CHECK(signed_cents<>0),
 currency text NOT NULL CHECK(currency='USD'),
 UNIQUE(business_id,id),
 UNIQUE(business_id,provider_namespace,external_account_id,id_namespace,external_id),
 FOREIGN KEY(business_id,external_account_id) REFERENCES crest.accounts(business_id,id)
);

CREATE TABLE crest.payments (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 customer_id uuid NOT NULL,
 channel_version_id uuid NOT NULL,
 account_id uuid NOT NULL,
 actual_on date NOT NULL,
 gross_cents bigint NOT NULL CHECK(gross_cents>0),
 confirmation text NOT NULL CHECK(char_length(confirmation)>=1 AND char_length(confirmation)<=1000),
 distinct_reason text CHECK(char_length(distinct_reason)>=1 AND char_length(distinct_reason)<=1000),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY(business_id,channel_version_id) REFERENCES crest.money_channel_versions(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE INDEX direct_payment_candidate ON crest.payments(business_id,customer_id,gross_cents,actual_on);

ALTER TABLE crest.financial_events ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE crest.financial_events ADD COLUMN payment_id uuid;
ALTER TABLE crest.financial_events DROP CONSTRAINT financial_events_template_check;
ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK(
 (template IN('P01','P02') AND invoice_id IS NOT NULL AND payment_id IS NULL)
 OR (template='P03' AND payment_id IS NOT NULL AND invoice_id IS NULL AND zero_effect_reason IS NULL));
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,payment_id);
ALTER TABLE crest.financial_events ADD FOREIGN KEY(business_id,payment_id) REFERENCES crest.payments(business_id,id);

CREATE TABLE crest.money_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 event_id uuid NOT NULL,
 account_id uuid NOT NULL,
 evidence_id uuid,
 signed_cents bigint NOT NULL CHECK(signed_cents>0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,event_id),
 UNIQUE(business_id,evidence_id),
 FOREIGN KEY(business_id,event_id) REFERENCES crest.financial_events(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,evidence_id) REFERENCES crest.external_money_evidence(business_id,id)
);

CREATE TABLE crest.funding_origins (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 payment_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 cents bigint NOT NULL CHECK(cents>0),
 currency text NOT NULL CHECK(currency='USD'),
 UNIQUE(business_id,id),
 UNIQUE(business_id,payment_id),
 FOREIGN KEY(business_id,payment_id) REFERENCES crest.payments(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id)
);

CREATE TABLE crest.funding_partitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 origin_id uuid NOT NULL,
 position integer NOT NULL CHECK(position>=1 AND position<=180),
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 UNIQUE(business_id,id),
 UNIQUE(business_id,origin_id,position),
 FOREIGN KEY(business_id,origin_id) REFERENCES crest.funding_origins(business_id,id)
);

CREATE TABLE crest.allocation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 event_id uuid NOT NULL,
 partition_id uuid NOT NULL,
 receivable_id uuid NOT NULL,
 cents bigint NOT NULL CHECK(cents>0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,partition_id),
 UNIQUE(business_id,event_id,receivable_id),
 FOREIGN KEY(business_id,event_id) REFERENCES crest.financial_events(business_id,id),
 FOREIGN KEY(business_id,partition_id) REFERENCES crest.funding_partitions(business_id,id),
 FOREIGN KEY(business_id,receivable_id) REFERENCES crest.receivable_items(business_id,id)
);
CREATE INDEX direct_receivable_application ON crest.allocation_events(business_id,receivable_id,event_id);

ALTER TABLE crest.journal_lines ALTER COLUMN invoice_item_id DROP NOT NULL;
ALTER TABLE crest.journal_lines ADD COLUMN money_movement_id uuid;
ALTER TABLE crest.journal_lines ADD COLUMN allocation_event_id uuid;
ALTER TABLE crest.journal_lines DROP CONSTRAINT journal_lines_purpose_check;
-- Discover the exact two schema77 predicates by their current column sets.
DO $checks$
DECLARE guard record; found_count integer:=0;
BEGIN
 FOR guard IN
  SELECT c.conname FROM pg_constraint c
  WHERE c.conrelid='crest.journal_lines'::regclass AND c.contype='c'
   AND cardinality(c.conkey)=2
   AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
    WHERE a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey))
    IN(ARRAY['purpose','receivable_id'],ARRAY['fixed_mapping_id','purpose'])
 LOOP
  EXECUTE format('ALTER TABLE crest.journal_lines DROP CONSTRAINT %I',guard.conname);
  found_count:=found_count+1;
 END LOOP;
 IF found_count<>2 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DIRECT_RECEIPT_SCHEMA_REVIEW_REQUIRED';END IF;
END $checks$;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK(
 (purpose IN('ar','discount','service_revenue','tax_payable') AND invoice_item_id IS NOT NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL
  AND (purpose='ar')=(receivable_id IS NOT NULL)
  AND (purpose='tax_payable')=(fixed_mapping_id IS NULL))
 OR (purpose='receipt_money' AND money_movement_id IS NOT NULL AND debit_cents>0 AND credit_cents=0
  AND invoice_item_id IS NULL AND receivable_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL)
 OR (purpose='receipt_ar' AND allocation_event_id IS NOT NULL AND receivable_id IS NOT NULL AND debit_cents=0 AND credit_cents>0
  AND invoice_item_id IS NULL AND money_movement_id IS NULL AND fixed_mapping_id IS NULL));
ALTER TABLE crest.journal_lines ADD UNIQUE(business_id,money_movement_id);
ALTER TABLE crest.journal_lines ADD UNIQUE(business_id,allocation_event_id);
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,money_movement_id) REFERENCES crest.money_movements(business_id,id);
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,allocation_event_id) REFERENCES crest.allocation_events(business_id,id);

DO $storage$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['payments','external_money_evidence','money_movements','funding_origins','funding_partitions','allocation_events'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',source);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',source);
  EXECUTE format('GRANT SELECT ON crest.%I TO crest_finance_integrity_owner',source);
  EXECUTE format('CREATE POLICY direct_receipt_integrity ON crest.%I FOR SELECT TO crest_finance_integrity_owner USING(true)',source);
  EXECUTE format('CREATE TRIGGER direct_receipt_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I
    FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',source);
 END LOOP;
END $storage$;

-- The historical dictionary checks the reviewed columns. In the shared tables
-- its projection stays invoice-only and the new physical shape is explicit.
ALTER POLICY invoice_source_export_read ON crest.financial_events USING(
 business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND invoice_id IS NOT NULL);
ALTER POLICY invoice_source_export_read ON crest.atomic_finance_groups USING(
 business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=atomic_finance_groups.business_id AND e.group_id=atomic_finance_groups.id));
ALTER POLICY invoice_source_export_read ON crest.journal_entries USING(
 business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=journal_entries.business_id AND e.id=journal_entries.event_id));
ALTER POLICY invoice_source_export_read ON crest.journal_lines USING(
 business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND invoice_item_id IS NOT NULL);

CREATE OR REPLACE FUNCTION crest_private.invoice_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
  WHEN 'financial_events' THEN expected_fields||ARRAY['payment_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['money_movement_id:uuid','allocation_event_id:uuid']
  ELSE expected_fields END;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
RESET ROLE;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY direct_receipt_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.receipt.record');
CREATE POLICY direct_receipt_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='payments');
CREATE POLICY direct_receipt_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.receipt.record','finance.receipt.retire'));
CREATE POLICY direct_receipt_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.receipt.record','finance.receipt.retire')
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY direct_receipt_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.receipt.record','finance.receipt.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.receipt.record','finance.receipt.retire') AND state='committed');
CREATE POLICY direct_receipt_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='payments' AND action='record' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY direct_receipt_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.receipt.retire' AND o.state='pending'));
CREATE POLICY direct_receipt_retirement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire');

DO $writer$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['payments','external_money_evidence','money_movements','funding_origins','funding_partitions','allocation_events',
   'financial_events','atomic_finance_groups','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE POLICY direct_receipt_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o
     WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
      AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
      AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
      AND o.command_type=''finance.receipt.record'' AND o.state=''pending''))',source);
 END LOOP;
 FOREACH source IN ARRAY ARRAY['payments','external_money_evidence','money_movements','funding_origins','funding_partitions','allocation_events'] LOOP
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_finance_account_owner',source);
  EXECUTE format('CREATE POLICY direct_receipt_read ON crest.%I FOR SELECT TO crest_finance_account_owner
   USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',source);
 END LOOP;
END $writer$;

CREATE FUNCTION crest_private.direct_receipt_channel(requested_business uuid,requested_channel uuid,actual_date date,requested_zone text)
RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $channel$
 SELECT v.id FROM (
   SELECT c.* FROM crest.money_channel_versions c WHERE c.business_id=requested_business AND c.channel_id=requested_channel
    AND c.effective_from<=actual_date ORDER BY c.effective_from DESC LIMIT 1
 ) v JOIN crest.accounts a ON a.business_id=v.business_id AND a.id=v.account_id
 WHERE v.active AND v.ownership_scope='dedicated_business' AND v.kind IN('bank','wallet')
  AND v.opening_state='verified_zero' AND v.opening_on<=actual_date
  AND crest_private.money_channel_account_matches(v.kind,v.ownership_scope,a)
  AND (SELECT av.active FROM crest.account_versions av WHERE av.business_id=a.business_id AND av.account_id=a.id
   ORDER BY av.version DESC LIMIT 1)
  AND (SELECT current_channel.active FROM crest.money_channel_versions current_channel
   WHERE current_channel.business_id=v.business_id AND current_channel.channel_id=v.channel_id
    AND current_channel.effective_from<=(statement_timestamp() AT TIME ZONE requested_zone)::date
   ORDER BY current_channel.effective_from DESC LIMIT 1);
$channel$;
REVOKE ALL ON FUNCTION crest_private.direct_receipt_channel(uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.direct_receipt_channel(uuid,uuid,date,text)
 TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE FUNCTION crest_private.verify_direct_receipt(requested_business uuid,requested_event uuid)
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
    OR r.original_cents<(SELECT sum(used.cents::numeric) FROM crest.allocation_events used
      WHERE used.business_id=r.business_id AND used.receivable_id=r.id))
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

CREATE FUNCTION crest_private.verify_direct_receipt_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE source_event uuid;
BEGIN
 CASE TG_TABLE_NAME
  WHEN 'payments' THEN SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND payment_id=NEW.id;
  WHEN 'external_money_evidence' THEN SELECT event_id INTO source_event FROM crest.money_movements WHERE business_id=NEW.business_id AND evidence_id=NEW.id;
  WHEN 'funding_origins' THEN SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND payment_id=NEW.payment_id;
  WHEN 'funding_partitions' THEN SELECT event_id INTO source_event FROM crest.allocation_events WHERE business_id=NEW.business_id AND partition_id=NEW.id;
  ELSE source_event:=NEW.event_id;
 END CASE;
 IF source_event IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_direct_receipt(NEW.business_id,source_event);
 RETURN NULL;
END $verify$;

RESET ROLE;
ALTER FUNCTION crest_private.verify_direct_receipt(uuid,uuid) OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_direct_receipt_rows() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_direct_receipt(uuid,uuid),crest_private.verify_direct_receipt_rows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_direct_receipt_rows() TO crest_schema_owner;

SET LOCAL ROLE crest_schema_owner;
DO $triggers$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['payments','external_money_evidence','money_movements','funding_origins','funding_partitions','allocation_events'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER direct_receipt_complete AFTER INSERT ON crest.%I
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_direct_receipt_rows()',source);
 END LOOP;
END $triggers$;
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_direct_receipt_rows() FROM crest_schema_owner;

SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.verify_finance_event_posting(requested_business uuid, requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE saved crest.financial_events;
BEGIN
 SELECT e.* INTO saved FROM crest.financial_events e
 WHERE e.business_id=requested_business AND e.id=requested_event;
 IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_EVENT_REQUIRED';
 END IF;
 CASE saved.template
  WHEN 'P01','P02' THEN
   PERFORM crest_private.verify_invoice_posting(saved.business_id,saved.invoice_id);
  WHEN 'P03' THEN
   PERFORM crest_private.verify_direct_receipt(saved.business_id,saved.id);
  ELSE
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_TEMPLATE_NOT_SUPPORTED';
 END CASE;
END $posting$;

CREATE FUNCTION crest_private.verify_finance_posting_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE source_event uuid;
BEGIN
 CASE TG_TABLE_NAME
  WHEN 'invoices' THEN
   SELECT e.id INTO source_event FROM crest.financial_events e
   WHERE e.business_id=NEW.business_id AND e.invoice_id=NEW.id;
  WHEN 'receivable_items' THEN
   SELECT e.id INTO source_event FROM crest.financial_events e
   WHERE e.business_id=NEW.business_id AND e.invoice_id=NEW.invoice_id;
  WHEN 'financial_events' THEN
   source_event:=NEW.id;
  WHEN 'invoice_tax_payable_movements','journal_entries' THEN
   source_event:=NEW.event_id;
  WHEN 'journal_lines' THEN
   SELECT e.event_id INTO source_event FROM crest.journal_entries e
   WHERE e.business_id=NEW.business_id AND e.id=NEW.entry_id;
  ELSE
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_SOURCE_NOT_SUPPORTED';
 END CASE;
 -- Keep the original deferred diagnostic for invoice-only callers.
 IF source_event IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_POSTING_EVENT_REQUIRED';
 END IF;
 PERFORM crest_private.verify_finance_event_posting(NEW.business_id,source_event);
 RETURN NULL;
END $posting$;

RESET ROLE;
ALTER FUNCTION crest_private.verify_finance_event_posting(uuid,uuid) OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_finance_posting_rows() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_finance_event_posting(uuid,uuid),
 crest_private.verify_finance_posting_rows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_finance_posting_rows() TO crest_schema_owner;

SET LOCAL ROLE crest_schema_owner;
DO $dispatch$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['invoices','financial_events','receivable_items',
  'invoice_tax_payable_movements','journal_entries','journal_lines'] LOOP
  EXECUTE format('DROP TRIGGER invoice_posting_required ON crest.%I',table_name);
  EXECUTE format('CREATE CONSTRAINT TRIGGER invoice_posting_required AFTER INSERT ON crest.%I
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_finance_posting_rows()',table_name);
 END LOOP;
END $dispatch$;
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_finance_posting_rows() FROM crest_schema_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_direct_fictional_receipt(
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
  SELECT receivable.original_cents-coalesce(sum(a.cents::numeric),0) INTO outstanding
  FROM crest.allocation_events a WHERE a.business_id=requested_business AND a.receivable_id=receivable.id;
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

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.record_direct_fictional_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,text,text,jsonb,jsonb) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.record_direct_fictional_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,text,text,jsonb,jsonb) FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_direct_fictional_receipt(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_payment uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_payment IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT o.id,o.command_type,o.recovery_epoch,o.result,o.payload_hash,p.id AS payment_id INTO saved
 FROM crest_private.operations o LEFT JOIN crest.payments p ON p.business_id=o.business_id AND p.operation_id=o.operation_id
 WHERE o.business_id=requested_business AND o.operation_id=original_operation AND o.actor_id=expected_actor
  AND o.command_type IN('finance.receipt.record','finance.receipt.retire') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.command_type='finance.receipt.retire' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'paymentId') IS DISTINCT FROM (original_epoch::text,original_payment::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.delta INTO audit_delta FROM crest_private.audit_events a
  WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
   AND a.entity_kind='operations' AND a.entity_id=saved.id AND a.action='retire' AND a.reason=saved.result->>'reason';
  IF saved.payment_id IS NOT NULL OR saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_RETIREMENT_AUDIT_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF (saved.recovery_epoch,saved.payment_id) IS DISTINCT FROM (original_epoch,original_payment) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;

CREATE FUNCTION crest_commands.retire_direct_fictional_receipt(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_payment uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR
  review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_direct_fictional_receipt($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'paymentId',original_payment,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.receipt.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_direct_fictional_receipt($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
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

CREATE FUNCTION crest_commands.read_direct_fictional_receipt_options(
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
  SELECT r.id,r.invoice_id,r.due_on,i.invoice_number,i.issued_on,r.original_cents-coalesce(
   (SELECT sum(a.cents::numeric) FROM crest.allocation_events a WHERE a.business_id=r.business_id AND a.receivable_id=r.id),0) AS remaining
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
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_direct_fictional_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_direct_fictional_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_direct_fictional_receipt_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,date) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_direct_fictional_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid),crest_commands.retire_direct_fictional_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text),crest_commands.read_direct_fictional_receipt_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_direct_fictional_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid),crest_commands.retire_direct_fictional_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text),crest_commands.read_direct_fictional_receipt_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,date),crest_commands.record_direct_fictional_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,text,text,jsonb,jsonb) TO crest_finance_preview;
