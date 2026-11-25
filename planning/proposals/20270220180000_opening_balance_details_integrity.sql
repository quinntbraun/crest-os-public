-- HELD audit/identity part. No application write grant or posting authority.
SET LOCAL ROLE crest_schema_owner;

CREATE POLICY opening_balance_details_operation_integrity ON crest_private.operations
 FOR SELECT TO crest_finance_integrity_owner USING(command_type='finance.opening_balance_details.save');
CREATE POLICY opening_balance_details_audit_integrity ON crest_private.audit_events
 FOR SELECT TO crest_finance_integrity_owner USING(entity_kind='opening_balance_details_schedule_revisions');

CREATE FUNCTION crest_private.opening_balance_details_receipt(saved crest.opening_balance_details_schedule_revisions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',saved.business_id,
  'scheduleRevisionId',saved.id,'worksheetRevisionId',saved.worksheet_revision_id,
  'revision',saved.revision::text,'operationId',saved.operation_id,
  'auditEventId',saved.audit_event_id,'recordedBy',saved.recorded_by,
  'recordedAt',to_char(saved.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'evidenceSha256',saved.evidence_sha256,'evidence',saved.evidence)
$receipt$;

CREATE FUNCTION crest_private.opening_balance_details_item_evidence(saved crest.opening_balance_details_item_revisions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $item$
 SELECT jsonb_build_object('itemId',i.id,'kind',i.source_kind,'sourceNamespace',o.source_namespace,
  'externalId',o.external_id,'accountId',saved.account_id,'accountVersion',saved.account_version::text,
  'amountCents',saved.amount_cents::text,'evidence',saved.evidence,'detail',saved.detail)
 FROM crest.opening_balance_details_items i JOIN crest.opening_balance_details_origins o
  ON o.business_id=i.business_id AND o.id=i.origin_id
 WHERE i.business_id=saved.business_id AND i.id=saved.item_id
  AND i.origin_id=saved.origin_id AND i.source_kind=saved.source_kind
$item$;

CREATE FUNCTION crest_private.check_opening_balance_details_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE previous crest.opening_balance_details_schedule_revisions;
 parent crest.opening_worksheet_revisions; represented jsonb; calculated jsonb;
BEGIN
 SELECT * INTO STRICT parent FROM crest.opening_worksheet_revisions w
  WHERE w.business_id=NEW.business_id AND w.id=NEW.worksheet_revision_id;
 IF parent.revision IS DISTINCT FROM(SELECT max(w.revision) FROM crest.opening_worksheet_revisions w WHERE w.business_id=NEW.business_id)
  OR NEW.evidence->>'cutoverOn' IS DISTINCT FROM to_char(parent.cutover_on,'YYYY-MM-DD')
  OR NEW.evidence->>'cutoverAt' IS DISTINCT FROM to_char(parent.cutover_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_BOUNDARY_REQUIRED'; END IF;
 IF NEW.prior_revision IS NOT NULL THEN
  SELECT * INTO STRICT previous FROM crest.opening_balance_details_schedule_revisions p
   WHERE p.business_id=NEW.business_id AND p.worksheet_revision_id=NEW.worksheet_revision_id
    AND p.revision=NEW.prior_revision;
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON a.business_id=o.business_id AND a.operation_id=o.operation_id AND a.actor_id=o.actor_id
   WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id
    AND o.actor_id=NEW.recorded_by AND o.command_type='finance.opening_balance_details.save'
    AND o.state='committed' AND o.result_schema_version=1
    AND o.result=crest_private.opening_balance_details_receipt(NEW)
    AND a.id=NEW.audit_event_id AND a.entity_id=NEW.id AND a.entity_version=NEW.revision
    AND a.entity_kind='opening_balance_details_schedule_revisions' AND a.action='review'
    AND a.reason=NEW.evidence->>'reason'
    AND a.delta=jsonb_build_object('schemaVersion',1,'before',
     CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_balance_details_receipt(previous) END,
     'after',o.result))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_AUDIT_REQUIRED'; END IF;
 SELECT coalesce(jsonb_agg(crest_private.opening_balance_details_item_evidence(v)
   ORDER BY v.sequence),'[]'::jsonb) INTO represented
 FROM crest.opening_balance_details_item_revisions v
 WHERE v.business_id=NEW.business_id AND v.schedule_revision_id=NEW.id;
 IF represented IS DISTINCT FROM NEW.evidence->'items'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_ITEM_COVERAGE_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM crest.opening_balance_details_item_revisions v
  WHERE v.business_id=NEW.business_id AND v.schedule_revision_id=NEW.id
  GROUP BY v.source_kind HAVING sum(v.amount_cents)>9223372036854775807 OR sum(v.amount_cents)< -9223372036854775807)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_TOTALS_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM crest.opening_balance_details_item_revisions v
  WHERE v.business_id=NEW.business_id AND v.schedule_revision_id=NEW.id
  GROUP BY v.origin_id HAVING count(*)>1 AND NOT(count(*)=2
   AND count(*) FILTER(WHERE v.source_kind='equipment_cost')=1
   AND count(*) FILTER(WHERE v.source_kind='accumulated_depreciation')=1))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_DUPLICATE_ORIGIN'; END IF;
 IF EXISTS(SELECT FROM crest.opening_balance_details_item_revisions v
  JOIN crest.opening_balance_details_items i ON i.business_id=v.business_id AND i.id=v.item_id
  WHERE v.business_id=NEW.business_id AND v.schedule_revision_id=NEW.id AND v.source_kind='wallet'
  GROUP BY v.account_id HAVING count(*)>1)
 OR EXISTS(SELECT FROM crest.opening_balance_details_item_revisions v
  JOIN crest.opening_balance_details_items i ON i.business_id=v.business_id AND i.id=v.item_id
  WHERE v.business_id=NEW.business_id AND v.schedule_revision_id=NEW.id AND v.source_kind='wallet'
  GROUP BY i.channel_id HAVING count(*)>1)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_DUPLICATE_WALLET'; END IF;
 IF EXISTS(SELECT FROM crest.opening_balance_details_item_revisions v
  JOIN crest.opening_balance_details_items i ON i.business_id=v.business_id AND i.id=v.item_id
  LEFT JOIN crest.opening_balance_details_item_revisions cost
   ON cost.business_id=v.business_id AND cost.schedule_revision_id=v.schedule_revision_id
    AND cost.item_id=i.cost_item_id AND cost.source_kind='equipment_cost'
  WHERE v.business_id=NEW.business_id AND v.schedule_revision_id=NEW.id
   AND v.source_kind='accumulated_depreciation'
   AND (cost.id IS NULL OR cost.amount_cents<v.amount_cents OR cost.account_id=v.account_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_DEPRECIATION_REQUIRED'; END IF;
 SELECT jsonb_object_agg(k.kind,jsonb_build_object('amountCents',coalesce(t.amount,0)::text,
  'itemCount',coalesce(t.item_count,0))) INTO calculated
 FROM unnest(ARRAY['wallet','cash','checks','transfer_transit','owner_custody','tax_liability',
  'debt','due_owner','equipment_cost','accumulated_depreciation','prepaid','other_asset','other_liability']) k(kind)
 LEFT JOIN(SELECT v.source_kind,sum(v.amount_cents) AS amount,count(*)::integer AS item_count
  FROM crest.opening_balance_details_item_revisions v
  WHERE v.business_id=NEW.business_id AND v.schedule_revision_id=NEW.id GROUP BY v.source_kind) t
 ON t.source_kind=k.kind;
 IF calculated IS DISTINCT FROM NEW.evidence->'totals'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_TOTALS_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM crest.opening_balance_details_item_revisions v
  JOIN crest.accounts a ON a.business_id=v.business_id AND a.id=v.account_id
  JOIN crest.account_versions av ON av.business_id=v.business_id AND av.account_id=v.account_id AND av.version=v.account_version
  JOIN(VALUES('wallet','asset','debit','wallet'),('cash','asset','debit','cash'),
   ('checks','asset','debit','checks'),('transfer_transit','asset','debit','transfer_transit'),
   ('owner_custody','asset','debit','owner_custody'),('tax_liability','liability','credit','tax_payable'),
   ('debt','liability','credit','debt'),('due_owner','liability','credit','due_owner'),
   ('equipment_cost','asset','debit','fixed_asset'),('accumulated_depreciation','asset','credit','accumulated_depreciation'),
   ('prepaid','asset','debit','prepaid'),('other_asset','asset','debit',NULL),
   ('other_liability','liability','credit',NULL)) expected(kind,account_type,normal_side,control_kind)
  ON expected.kind=v.source_kind
  WHERE v.business_id=NEW.business_id AND v.schedule_revision_id=NEW.id
   AND (a.currency<>'USD' OR NOT av.active OR a.account_type<>expected.account_type
    OR a.normal_side<>expected.normal_side OR a.control_kind IS DISTINCT FROM expected.control_kind
    OR av.version<>(SELECT max(latest.version) FROM crest.account_versions latest
     WHERE latest.business_id=av.business_id AND latest.account_id=av.account_id)))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_ACCOUNT_REQUIRED'; END IF;
 RETURN NULL;
END $history$;

CREATE FUNCTION crest_private.check_opening_balance_details_identity_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $identity$
DECLARE saved crest.opening_balance_details_schedule_revisions; item crest.opening_balance_details_items;
 cost crest.opening_balance_details_items;
BEGIN
 IF TG_TABLE_NAME='opening_balance_details_origins' THEN
  IF NOT EXISTS(SELECT FROM crest.opening_balance_details_item_revisions v
   JOIN crest.opening_balance_details_schedule_revisions s ON s.business_id=v.business_id AND s.id=v.schedule_revision_id
   WHERE v.business_id=NEW.business_id AND v.origin_id=NEW.id
    AND s.operation_id=NEW.operation_id AND s.recorded_by=NEW.recorded_by)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_ORIGIN_AUDIT_REQUIRED'; END IF;
 ELSIF TG_TABLE_NAME='opening_balance_details_items' THEN
  IF NOT EXISTS(SELECT FROM crest.opening_balance_details_item_revisions v
   JOIN crest.opening_balance_details_schedule_revisions s ON s.business_id=v.business_id AND s.id=v.schedule_revision_id
   WHERE v.business_id=NEW.business_id AND v.item_id=NEW.id
    AND s.operation_id=NEW.operation_id AND s.recorded_by=NEW.recorded_by)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_IDENTITY_AUDIT_REQUIRED'; END IF;
 ELSE
  SELECT * INTO STRICT saved FROM crest.opening_balance_details_schedule_revisions s
   WHERE s.business_id=NEW.business_id AND s.id=NEW.schedule_revision_id;
  SELECT * INTO STRICT item FROM crest.opening_balance_details_items i
   WHERE i.business_id=NEW.business_id AND i.id=NEW.item_id;
  IF (NEW.operation_id,NEW.recorded_by) IS DISTINCT FROM (saved.operation_id,saved.recorded_by)
   OR (saved.evidence->'items')->(NEW.sequence-1) IS DISTINCT FROM crest_private.opening_balance_details_item_evidence(NEW)
   OR item.asset_id::text IS DISTINCT FROM NEW.detail->>'assetId'
   OR item.owner_id::text IS DISTINCT FROM NEW.detail->>'ownerId'
   OR item.channel_id::text IS DISTINCT FROM NEW.detail->>'channelId'
   OR item.cost_item_id::text IS DISTINCT FROM NEW.detail->>'costItemId'
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_ITEM_AUDIT_REQUIRED'; END IF;
  IF item.source_kind='accumulated_depreciation' THEN
   SELECT * INTO STRICT cost FROM crest.opening_balance_details_items c
    WHERE c.business_id=item.business_id AND c.id=item.cost_item_id;
   IF cost.source_kind<>'equipment_cost' OR (cost.origin_id,cost.asset_id) IS DISTINCT FROM (item.origin_id,item.asset_id)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_BALANCE_DETAILS_ASSET_IDENTITY_REQUIRED'; END IF;
  END IF;
 END IF;
 RETURN NULL;
END $identity$;

CREATE CONSTRAINT TRIGGER opening_balance_details_audited
 AFTER INSERT ON crest.opening_balance_details_schedule_revisions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_balance_details_history();
CREATE CONSTRAINT TRIGGER opening_balance_details_origin_audited
 AFTER INSERT ON crest.opening_balance_details_origins DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_balance_details_identity_history();
CREATE CONSTRAINT TRIGGER opening_balance_details_identity_audited
 AFTER INSERT ON crest.opening_balance_details_items DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_balance_details_identity_history();
CREATE CONSTRAINT TRIGGER opening_balance_details_item_audited
 AFTER INSERT ON crest.opening_balance_details_item_revisions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_balance_details_identity_history();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_balance_details_history() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_balance_details_identity_history() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.opening_balance_details_receipt(crest.opening_balance_details_schedule_revisions),
 crest_private.opening_balance_details_item_evidence(crest.opening_balance_details_item_revisions),
 crest_private.check_opening_balance_details_history(),
 crest_private.check_opening_balance_details_identity_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.opening_balance_details_receipt(crest.opening_balance_details_schedule_revisions),
 crest_private.opening_balance_details_item_evidence(crest.opening_balance_details_item_revisions)
 TO crest_finance_integrity_owner,crest_finance_account_owner;
