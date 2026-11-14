-- Fictional P03 excess. Original partitions and receipts remain immutable.
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.customer_fund_lots ALTER COLUMN unapplication_id DROP NOT NULL;
ALTER TABLE crest.customer_fund_lots ADD COLUMN receipt_event_id uuid;
ALTER TABLE crest.customer_fund_lots ADD CONSTRAINT fund_lot_one_source CHECK(num_nonnulls(unapplication_id,receipt_event_id)=1);
ALTER TABLE crest.customer_fund_lots ADD UNIQUE(business_id,receipt_event_id);
ALTER TABLE crest.customer_fund_lots ADD FOREIGN KEY(business_id,receipt_event_id) REFERENCES crest.financial_events(business_id,id);
CREATE POLICY receipt_fund_lot_insert ON crest.customer_fund_lots FOR INSERT TO crest_finance_account_owner
 WITH CHECK(unapplication_id IS NULL AND receipt_event_id IS NOT NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=customer_fund_lots.business_id
   AND o.operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
   AND o.actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
   AND o.command_type='finance.receipt.record' AND o.state='pending'));
ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK((((((((((
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
  AND money_movement_id IS NULL AND allocation_event_id IS NULL)) AND fund_application_id IS NULL)
 OR (purpose='apply_funds' AND fund_application_id IS NOT NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND money_movement_id IS NULL
  AND allocation_event_id IS NULL AND unapplication_id IS NULL)
 OR (purpose='apply_ar' AND fund_application_id IS NOT NULL AND receivable_id IS NOT NULL AND debit_cents=0 AND credit_cents>0
  AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL
  AND unapplication_id IS NULL AND fund_lot_id IS NULL)) AND tip_realization_id IS NULL)
 OR (purpose='tip_funds' AND tip_realization_id IS NOT NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND tax_payable_movement_id IS NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL)
 OR (purpose='tip_revenue' AND tip_realization_id IS NOT NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND tax_payable_movement_id IS NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL)
 OR (purpose='tip_tax' AND tip_realization_id IS NOT NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND tax_payable_movement_id IS NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL)) AND invoice_credit_id IS NULL)
 OR (purpose IN('credit_returns','credit_discount') AND invoice_credit_id IS NOT NULL AND receivable_id IS NULL AND fixed_mapping_id IS NOT NULL
  AND (purpose='credit_returns')=(debit_cents>0) AND (purpose='credit_discount')=(credit_cents>0) AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_lot_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL AND tax_payable_movement_id IS NULL)
 OR (purpose='credit_ar' AND invoice_credit_id IS NOT NULL AND receivable_id IS NOT NULL AND fixed_mapping_id IS NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_lot_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL AND tax_payable_movement_id IS NULL)
 OR (purpose='credit_tax' AND invoice_credit_id IS NOT NULL AND receivable_id IS NULL AND fixed_mapping_id IS NULL
  AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_lot_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL AND tax_payable_movement_id IS NULL)) AND service_refund_id IS NULL)
 OR (purpose='refund_funds' AND service_refund_id IS NOT NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents>0 AND credit_cents=0 AND money_movement_id IS NULL AND invoice_item_id IS NULL AND receivable_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_application_id IS NULL AND tip_realization_id IS NULL AND invoice_credit_id IS NULL AND tax_payable_movement_id IS NULL)
 OR (purpose='refund_money' AND service_refund_id IS NOT NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NULL
  AND debit_cents=0 AND credit_cents>0 AND money_movement_id IS NOT NULL AND invoice_item_id IS NULL AND receivable_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_application_id IS NULL AND tip_realization_id IS NULL AND invoice_credit_id IS NULL AND tax_payable_movement_id IS NULL))
 OR (purpose='receipt_funds' AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND money_movement_id IS NULL
  AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL
  AND invoice_credit_id IS NULL AND service_refund_id IS NULL AND tax_payable_movement_id IS NULL));
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.verify_direct_receipt(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; p crest.payments; root crest.funding_origins;
 movement crest.money_movements; money crest.external_money_evidence; journal uuid; channel crest.money_channel_versions;
 operation_result jsonb; expected_receipt jsonb; expected_applications jsonb; held crest.customer_fund_lots;
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

 SELECT * INTO held FROM crest.customer_fund_lots WHERE business_id=e.business_id AND receipt_event_id=e.id;
 IF held.id IS NOT NULL AND ((held.origin_id,held.customer_id) IS DISTINCT FROM (root.id,p.customer_id)
  OR held.mapping_id IS DISTINCT FROM crest_private.unapplication_funds_mapping(e.business_id,e.effective_on)
  OR NOT EXISTS(SELECT FROM crest.account_mapping_versions m WHERE (m.business_id,m.id,m.account_id)=(e.business_id,held.mapping_id,held.account_id))
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE (x.business_id,x.entry_id,x.fund_lot_id,x.account_id,x.fixed_mapping_id,x.credit_cents)
   =(e.business_id,journal,held.id,held.account_id,held.mapping_id,held.original_cents) AND x.purpose='receipt_funds'))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_FUNDS_MAPPING_REQUIRED';END IF;
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
    OR CASE WHEN x.id=held.parent_partition_id THEN a.id IS NOT NULL OR x.last_cent<>root.cents
       OR held.original_cents<>x.last_cent-x.first_cent+1
      ELSE (a.event_id,a.cents,r.customer_id) IS DISTINCT FROM (e.id,x.last_cent-x.first_cent+1,p.customer_id)
    OR i.issued_on>p.actual_on OR original_group.id IS NULL OR receipt_group.id IS NULL
    OR original_group.commit_sequence>=receipt_group.commit_sequence
    OR (line.entry_id,line.account_id,line.receivable_id,line.credit_cents) IS DISTINCT FROM (journal,r.account_id,r.id,a.cents)
    OR NOT crest_private.receivable_has_nonnegative_history(r.business_id,r.id,r.original_cents) END)
  OR (SELECT max(x.last_cent) FROM crest.funding_partitions x WHERE x.business_id=e.business_id AND x.origin_id=root.id)<>root.cents
  OR EXISTS(SELECT FROM crest.allocation_events a JOIN crest.funding_partitions x
    ON x.business_id=a.business_id AND x.id=a.partition_id WHERE a.business_id=e.business_id AND a.event_id=e.id AND x.origin_id<>root.id)
  OR NOT EXISTS(SELECT FROM crest.journal_lines line WHERE line.business_id=e.business_id AND line.entry_id=journal
    AND line.money_movement_id=movement.id AND line.account_id=movement.account_id AND line.debit_cents=movement.signed_cents)
  OR (SELECT count(*) FROM crest.journal_lines line WHERE line.business_id=e.business_id AND line.entry_id=journal)
   <>1+(held.id IS NOT NULL)::int+(SELECT count(*) FROM crest.allocation_events a WHERE a.business_id=e.business_id AND a.event_id=e.id)
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
  'applications',coalesce(expected_applications,'[]'::jsonb));
 IF held.id IS NOT NULL THEN
  IF NOT EXISTS(SELECT FROM crest.funding_partitions x WHERE (x.business_id,x.id,x.origin_id)=(e.business_id,held.parent_partition_id,root.id))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_APPLICATION_EFFECT_REQUIRED';END IF;
  expected_receipt:=expected_receipt||jsonb_build_object('schemaVersion',2,'heldFunds',jsonb_build_object(
   'lotId',held.id,'fundingPartitionId',held.parent_partition_id,'mappingId',held.mapping_id,'cents',held.original_cents::text));
 END IF;
 IF operation_result IS DISTINCT FROM expected_receipt THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_SOURCE_REQUIRED';
 END IF;
END $verify$;

CREATE OR REPLACE FUNCTION crest_private.verify_direct_receipt_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE source_event uuid;
BEGIN
 CASE TG_TABLE_NAME
  WHEN 'payments' THEN SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND payment_id=NEW.id;
  WHEN 'external_money_evidence' THEN SELECT event_id INTO source_event FROM crest.money_movements WHERE business_id=NEW.business_id AND evidence_id=NEW.id;
  WHEN 'funding_origins' THEN SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND payment_id=NEW.payment_id;
  WHEN 'funding_partitions' THEN
   SELECT e.id INTO source_event FROM crest.funding_origins root JOIN crest.financial_events e
    ON (e.business_id,e.payment_id)=(root.business_id,root.payment_id)
   WHERE (root.business_id,root.id)=(NEW.business_id,NEW.origin_id);
  WHEN 'allocation_events' THEN
   SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND id=NEW.event_id AND template='P03';
  ELSE source_event:=NEW.event_id;
 END CASE;
 IF source_event IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_finance_event_posting(NEW.business_id,source_event);
 RETURN NULL;
END $verify$;

CREATE OR REPLACE FUNCTION crest_private.verify_fictional_unapplication_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE source uuid; event_id uuid;
BEGIN
 IF TG_TABLE_NAME='allocation_unapplications' THEN
  source:=NEW.id;
 ELSIF NEW.receipt_event_id IS NOT NULL THEN
  PERFORM crest_private.verify_direct_receipt(NEW.business_id,NEW.receipt_event_id);
  RETURN NULL;
 ELSE
  source:=NEW.unapplication_id;
 END IF;
 SELECT e.id INTO event_id FROM crest.financial_events e WHERE e.business_id=NEW.business_id AND e.unapplication_id=source;
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_fictional_unapplication(NEW.business_id,event_id);
 RETURN NULL;
END $verify$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.record_direct_fictional_receipt_with_funds(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_payment uuid,requested_customer uuid,requested_channel uuid,
 expected_channel_version bigint,actual_on date,gross_cents bigint,confirmation text,distinct_reason text,external_identity jsonb,
 applications jsonb,requested_funds_mapping uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $record$
DECLARE
 auth jsonb; digest text; saved record; channel crest.money_channel_versions; period record; allocation record;
 receivable crest.receivable_items; group_id uuid; event_id uuid; journal_id uuid; origin_id uuid; partition_id uuid;
 application_id uuid; evidence_id uuid; movement_id uuid; claimed uuid; position integer:=0; used bigint:=0;
 outstanding numeric; allocated numeric; held_cents bigint; funds_account uuid; lot_id uuid; digest_fields jsonb; receipt jsonb; output_applications jsonb:='[]'::jsonb;
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
 IF (SELECT count(*) FROM jsonb_each(applications)) NOT BETWEEN 0 AND 180
  OR EXISTS(SELECT FROM jsonb_each(applications) a
   WHERE a.key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(a.value) IS DISTINCT FROM 'string' OR a.value#>>'{}'!~'^[1-9][0-9]{0,18}$')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_INPUT_REQUIRED';END IF;
 SELECT coalesce(sum((a.value#>>'{}')::numeric),0) INTO allocated FROM jsonb_each(applications) a;
 IF allocated>gross_cents OR (allocated=gross_cents)<>(requested_funds_mapping IS NULL)
  OR requested_funds_mapping IS NOT NULL AND (SELECT count(*) FROM jsonb_each(applications))>=180
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_FULL_ALLOCATION_REQUIRED';END IF;
 held_cents:=gross_cents-allocated;

 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest_fields:=jsonb_build_array('finance.receipt.record',1,requested_business,expected_actor,
  expected_epoch,requested_payment,requested_customer,requested_channel,expected_channel_version,actual_on,gross_cents::text,
  confirmation,distinct_reason,external_identity,applications);
 IF requested_funds_mapping IS NOT NULL THEN
  digest_fields:=jsonb_set(digest_fields,'{1}','2'::jsonb)||jsonb_build_array(requested_funds_mapping);
 END IF;
 digest:=encode(sha256(convert_to(digest_fields::text,'UTF8')),'hex');
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
 IF requested_funds_mapping IS NOT NULL THEN
  SELECT m.account_id INTO funds_account FROM crest.account_mapping_versions m
  WHERE (m.business_id,m.id)=(requested_business,requested_funds_mapping)
    AND m.id=crest_private.unapplication_funds_mapping(requested_business,actual_on);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_FUNDS_MAPPING_REQUIRED';END IF;
 END IF;

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
    AND p.gross_cents=record_direct_fictional_receipt_with_funds.gross_cents
    AND p.actual_on BETWEEN record_direct_fictional_receipt_with_funds.actual_on-1 AND record_direct_fictional_receipt_with_funds.actual_on+1
    AND v.kind=channel.kind AND (external_identity IS NULL OR m.evidence_id IS NULL))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_DUPLICATE_REVIEW_REQUIRED';END IF;

 FOR allocation IN SELECT a.key::uuid AS receivable_id,(a.value#>>'{}')::bigint AS cents FROM jsonb_each(applications) a ORDER BY a.key LOOP
  SELECT r.* INTO receivable FROM crest.receivable_items r JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
   WHERE r.business_id=requested_business AND r.id=allocation.receivable_id AND r.customer_id=requested_customer
    AND i.issued_on<=record_direct_fictional_receipt_with_funds.actual_on;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_RECEIVABLE_REQUIRED';END IF;
  SELECT min(remaining) INTO outstanding FROM (
   SELECT receivable.original_cents+coalesce(sum(d.signed_cents)
    FILTER(WHERE d.effective_on<=record_direct_fictional_receipt_with_funds.actual_on),0) AS remaining
   FROM crest_private.receivable_posted_deltas(requested_business,receivable.id) d
   UNION ALL
   SELECT receivable.original_cents+dated.running FROM (
    SELECT d.effective_on,sum(d.signed_cents) OVER(ORDER BY d.effective_on,d.commit_sequence,d.event_sequence) AS running
    FROM crest_private.receivable_posted_deltas(requested_business,receivable.id) d
   ) dated WHERE dated.effective_on>record_direct_fictional_receipt_with_funds.actual_on
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
 IF held_cents>0 THEN
  INSERT INTO crest.funding_partitions(business_id,origin_id,position,first_cent,last_cent)
  VALUES(requested_business,origin_id,position+1,used+1,gross_cents) RETURNING id INTO partition_id;
  INSERT INTO crest.customer_fund_lots(business_id,receipt_event_id,origin_id,parent_partition_id,customer_id,account_id,mapping_id,original_cents)
  VALUES(requested_business,event_id,origin_id,partition_id,requested_customer,funds_account,requested_funds_mapping,held_cents) RETURNING id INTO lot_id;
  INSERT INTO crest.journal_lines(business_id,entry_id,account_id,fixed_mapping_id,fund_lot_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,funds_account,requested_funds_mapping,lot_id,'receipt_funds',0,held_cents);
  receipt:=receipt||jsonb_build_object('schemaVersion',2,'heldFunds',jsonb_build_object(
   'lotId',lot_id,'fundingPartitionId',partition_id,'mappingId',requested_funds_mapping,'cents',held_cents::text));
 END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'payments',requested_payment,1,'record',confirmation,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=(receipt->>'schemaVersion')::integer,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $record$;

CREATE OR REPLACE FUNCTION crest_commands.record_direct_fictional_receipt(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_payment uuid,requested_customer uuid,requested_channel uuid,
 expected_channel_version bigint,actual_on date,gross_cents bigint,confirmation text,distinct_reason text,external_identity jsonb,
 applications jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $record$
BEGIN
 RETURN crest_commands.record_direct_fictional_receipt_with_funds($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NULL);
END $record$;

CREATE FUNCTION crest_commands.read_direct_fictional_receipt_funds_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_date date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE result jsonb;
BEGIN
 result:=crest_commands.read_direct_fictional_receipt_options($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 IF result->>'state'<>'ready' THEN RETURN result;END IF;
 RETURN result||jsonb_build_object('fundsMappingId',crest_private.unapplication_funds_mapping(requested_business,(result->>'actualOn')::date));
END $options$;

CREATE OR REPLACE FUNCTION crest_commands.read_fictional_customer_funds(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $funds$
DECLARE auth jsonb; zone text; selected date; result jsonb; ties boolean;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH verified AS MATERIALIZED (
  SELECT crest_private.fictional_posted_report_context_v6(requested_business,selected,zone) AS context
 ), ledger AS MATERIALIZED (
  SELECT j.fund_lot_id,sum(j.credit_cents::numeric-j.debit_cents::numeric) AS cents
  FROM crest.journal_lines j
  JOIN crest.accounts a ON (a.business_id,a.id)=(j.business_id,j.account_id)
  JOIN crest.journal_entries entry ON (entry.business_id,entry.id)=(j.business_id,j.entry_id)
  JOIN crest.financial_events e ON (e.business_id,e.id)=(entry.business_id,entry.event_id)
  WHERE j.business_id=requested_business AND a.code='2000' AND e.effective_on<=selected
  GROUP BY j.fund_lot_id
 ), lots AS MATERIALIZED (
  SELECT l.id,l.origin_id,l.customer_id,c.display_name,e.effective_on,d.cents
  FROM ledger d
  JOIN crest.customer_fund_lots l ON (l.business_id,l.id)=(requested_business,d.fund_lot_id)
  JOIN crest.customers c ON (c.business_id,c.id)=(l.business_id,l.customer_id)
  JOIN crest.financial_events e ON e.business_id=l.business_id AND (e.unapplication_id=l.unapplication_id OR e.id=l.receipt_event_id)
  WHERE d.cents>0 AND e.effective_on<=selected
 ), totals AS (
  SELECT count(*)::text AS count,coalesce(sum(cents),0) AS cents FROM lots
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'throughOn',v.context->>'throughOn',
   'observedAt',v.context->>'observedAt','timeZone',zone,'currency','USD',
   'lotCount',t.count,'totalCents',t.cents::text,'rows',coalesce((
    SELECT jsonb_agg(jsonb_build_object('lotId',p.id,'originId',p.origin_id,'customerId',p.customer_id,
     'customerName',p.display_name,'heldOn',to_char(p.effective_on,'YYYY-MM-DD'),'heldCents',p.cents::text)
     ORDER BY p.effective_on,p.id)
    FROM (SELECT * FROM lots ORDER BY effective_on,id LIMIT 100) p
   ),'[]'::jsonb)),
   t.cents=(SELECT coalesce(sum(cents),0) FROM ledger)
    AND NOT EXISTS(SELECT FROM ledger WHERE fund_lot_id IS NULL OR cents<0)
 INTO result,ties FROM verified v CROSS JOIN totals t;
 IF ties IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_CUSTOMER_FUNDS_CONTROL_FAILED';
 END IF;
 RETURN result;
END $funds$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.record_direct_fictional_receipt_with_funds(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,text,text,jsonb,jsonb,uuid),
 crest_commands.read_direct_fictional_receipt_funds_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_direct_fictional_receipt_with_funds(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,text,text,jsonb,jsonb,uuid),
 crest_commands.read_direct_fictional_receipt_funds_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.fictional_posted_report_context_v6(requested_business uuid,through_on date,zone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE event_count bigint; coverage_start date;
BEGIN
 IF through_on<DATE '1900-01-01' OR through_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_DATE_REQUIRED';
 END IF;
 SELECT count(*),min(e.effective_on) INTO event_count,coverage_start FROM crest.financial_events e
 WHERE e.business_id=requested_business AND e.effective_on<=through_on;
 IF EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=requested_business AND e.effective_on<=through_on
  AND e.template NOT IN('P01','P02','P03','P04','P05','P06','P07','P08','P12')) THEN
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
   SELECT l.id,l.account_id,l.original_cents::numeric-coalesce((
    SELECT sum(a.last_cent::numeric-a.first_cent+1) FROM crest.fund_lot_range_consumptions a
    JOIN crest.financial_events applied ON applied.business_id=a.business_id
     AND ((a.fund_application_id IS NOT NULL AND applied.fund_application_id=a.fund_application_id)
      OR (a.tip_realization_id IS NOT NULL AND applied.tip_realization_id=a.tip_realization_id)
      OR (a.service_refund_id IS NOT NULL AND applied.service_refund_id=a.service_refund_id))
    WHERE a.business_id=l.business_id AND a.fund_lot_id=l.id AND applied.effective_on<=through_on
   ),0) AS available FROM crest.customer_fund_lots l
   JOIN crest.financial_events e ON e.business_id=l.business_id AND (e.unapplication_id=l.unapplication_id OR e.id=l.receipt_event_id)
   WHERE l.business_id=requested_business AND e.effective_on<=through_on
  ), journal AS (
   SELECT l.fund_lot_id,l.account_id,sum(l.credit_cents::numeric-l.debit_cents::numeric) AS cents
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND e.effective_on<=through_on AND l.fund_lot_id IS NOT NULL
   GROUP BY l.fund_lot_id,l.account_id
  )
  SELECT FROM lots a FULL JOIN journal j ON j.fund_lot_id=a.id AND j.account_id=a.account_id
  WHERE a.id IS NULL OR j.fund_lot_id IS NULL OR a.available<0 OR a.available IS DISTINCT FROM j.cents
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_CUSTOMER_FUNDS_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH booked AS (
   SELECT m.account_id,sum(m.cents::numeric) AS cents
   FROM crest.invoice_tax_payable_movements m JOIN crest.financial_events e ON e.business_id=m.business_id AND e.id=m.event_id
   WHERE m.business_id=requested_business AND e.effective_on<=through_on GROUP BY m.account_id
   UNION ALL
   SELECT t.tax_account_id,sum(t.tax_cents::numeric)
   FROM crest.tip_realizations t JOIN crest.financial_events e ON e.business_id=t.business_id AND e.tip_realization_id=t.id
   WHERE t.business_id=requested_business AND t.tax_cents>0 AND e.effective_on<=through_on GROUP BY t.tax_account_id
   UNION ALL
   SELECT c.tax_account_id,-sum(c.tax_cents::numeric)
   FROM crest.invoice_credits c JOIN crest.financial_events e ON e.business_id=c.business_id AND e.invoice_credit_id=c.id
   WHERE c.business_id=requested_business AND c.tax_cents>0 AND e.effective_on<=through_on GROUP BY c.tax_account_id
  ), source AS (
   SELECT account_id,sum(cents) AS cents FROM booked GROUP BY account_id
  ), ledger AS (
   SELECT l.account_id,sum(l.credit_cents::numeric-l.debit_cents::numeric) AS cents
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   JOIN crest.accounts a ON a.business_id=l.business_id AND a.id=l.account_id
   WHERE l.business_id=requested_business AND a.control_kind='tax_payable' AND e.effective_on<=through_on
   GROUP BY l.account_id
  )
  SELECT FROM source s FULL JOIN ledger l ON l.account_id=s.account_id
  WHERE s.account_id IS NULL OR l.account_id IS NULL OR s.cents IS DISTINCT FROM l.cents
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_TAX_CONTROL_FAILED';END IF;
 RETURN jsonb_build_object('schemaVersion',6,'businessId',requested_business,'currency','USD','timeZone',zone,
  'throughOn',to_char(through_on,'YYYY-MM-DD'),'observedAt',
  to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'postedEventCount',event_count::text,'coverageStart',to_char(coverage_start,'YYYY-MM-DD'),
  'coverage',jsonb_build_object('complete',false,'openingBalancesIncluded',false,'reconciliationVerified',false,
   'templates',jsonb_build_array('P01','P02','P03','P04','P05','P06','P07','P08','P12')),
  'controls',jsonb_build_object('ledgerBalanced',true,'receivablesTie',true,'moneyMovementsTie',true,'customerFundsTie',true,'taxPayableTie',true));
END $report$;
RESET ROLE;

-- The original P05 source keeps its original row shape and excludes P03 lots.
SET LOCAL ROLE crest_schema_owner;
ALTER POLICY unapplication_source_export_read ON crest.customer_fund_lots TO crest_unapplication_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND unapplication_id IS NOT NULL);
GRANT SELECT(id,business_id,unapplication_id,origin_id,parent_partition_id,customer_id,account_id,mapping_id,original_cents,receipt_event_id)
 ON crest.customer_fund_lots TO crest_receipt_export_owner;
GRANT SELECT(fund_lot_id) ON crest.journal_lines TO crest_receipt_export_owner;
CREATE POLICY receipt_lots_source_export ON crest.customer_fund_lots FOR SELECT TO crest_receipt_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND receipt_event_id IS NOT NULL);

CREATE FUNCTION crest_commands.receipt_funds_source_snapshot(requested_business uuid,expected_snapshot text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $snapshot$
DECLARE result jsonb;
BEGIN
 IF expected_snapshot IS NULL OR expected_snapshot IS DISTINCT FROM crest_private.receipt_source_token(requested_business) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RECEIPT_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO result FROM (
  SELECT lot.id,lot.business_id,lot.unapplication_id,lot.origin_id,lot.parent_partition_id,lot.customer_id,
   lot.account_id,lot.mapping_id,lot.original_cents::text,lot.receipt_event_id,line.id AS journal_line_id
  FROM crest.customer_fund_lots lot JOIN crest.journal_entries j
   ON (j.business_id,j.event_id)=(lot.business_id,lot.receipt_event_id)
  JOIN crest.journal_lines line ON (line.business_id,line.entry_id,line.fund_lot_id)=(j.business_id,j.id,lot.id)
   AND line.purpose='receipt_funds'
  WHERE lot.business_id=requested_business ORDER BY lot.id LIMIT 1001
 ) x;
 IF jsonb_array_length(result)>1000 OR octet_length(result::text)>4194304 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_RECEIPT_SOURCE_LIMIT';END IF;
 RETURN result;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_receipt_export_owner;
ALTER FUNCTION crest_commands.receipt_funds_source_snapshot(uuid,text) OWNER TO crest_receipt_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_receipt_export_owner;
REVOKE ALL ON FUNCTION crest_commands.receipt_funds_source_snapshot(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.receipt_funds_source_snapshot(uuid,text) TO crest_export;

SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.unapplication_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['fund_application_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group='customer_fund_lots' THEN expected_fields:=expected_fields||ARRAY['receipt_event_id:uuid'];END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNAPPLICATION_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
SET LOCAL ROLE crest_command_owner;
CREATE OR REPLACE FUNCTION crest_commands.record_posted_finance_export_access(credential_hash bytea,expected_session uuid,expected_actor uuid,
 expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,source_version integer,app_release text,observed_at text,manifest_digest text,archive_digest text,archive_bytes integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $handoff$
DECLARE operation uuid:=gen_random_uuid(); event uuid; scope jsonb; receipt jsonb; recorded timestamptz; observed timestamptz;
BEGIN
 IF expected_epoch IS NULL OR source_version IS NULL OR source_version NOT BETWEEN 89 AND 999
   OR app_release IS NULL OR app_release!~'^[a-f0-9]{40}$' OR observed_at IS NULL
   OR observed_at!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?\+00:00$'
   OR manifest_digest IS NULL OR manifest_digest!~'^[a-f0-9]{64}$' OR archive_digest IS NULL OR archive_digest!~'^[a-f0-9]{64}$'
   OR archive_bytes IS NULL OR archive_bytes NOT BETWEEN 1 AND 8388608 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 observed:=observed_at::timestamptz;
 IF NOT isfinite(observed) OR observed>clock_timestamp() OR observed<=clock_timestamp()-interval '2 minutes' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
   set_config('crest.operation_id',operation::text,true);
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
   'appReleaseId',app_release,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,
   'observedAt',observed_at,'manifestSha256',manifest_digest,'archiveSha256',archive_digest,'archiveBytes',archive_bytes);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'finance.export_access',1,expected_epoch,
  encode(sha256(convert_to(scope::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'finance_export_accesses',operation,1,'authorized_handoff',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',scope),'manual') RETURNING id,recorded_at INTO event,recorded;
 receipt:=jsonb_build_object('schemaVersion',1,'state','authorized_handoff','operationId',operation,'auditEventId',event,
  'recordedAt',to_char(recorded AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'scope',scope);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=operation AND actor_id=expected_actor;
 PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch,operation);
 RETURN receipt;
END $handoff$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
