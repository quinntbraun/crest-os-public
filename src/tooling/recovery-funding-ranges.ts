// Original-offset checks from registered fund-lot posting contracts. These
// fixed reads never invoke a privileged helper, repair records or post money.
import {isLiveRecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
export class RecoveryFundingRangeError extends Error{constructor(){super('RECOVERY_FUNDING_RANGE_REVIEW_REQUIRED');this.name='RecoveryFundingRangeError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryFundingRangeError();}
export async function verifyRecoveryFundingRanges(snapshot:RecoveryBackupSnapshot,signal:AbortSignal){
 try{
  require(isLiveRecoveryBackupSnapshot(snapshot));signal.throwIfAborted();
  const query:RecoveryBackupSnapshot['query']=async(sql,values)=>{require(isLiveRecoveryBackupSnapshot(snapshot));signal.throwIfAborted();const result=await snapshot.query(sql,values);signal.throwIfAborted();require(isLiveRecoveryBackupSnapshot(snapshot));return result;};
  const mode=(await query("SELECT current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation")).rows[0];require(mode?.read_only==='on'&&mode.isolation==='repeatable read');
  const ranges=(await query(`WITH sources AS (
   SELECT l.business_id,l.id,s.first_cent::numeric,s.last_cent::numeric
   FROM crest.customer_fund_lots l CROSS JOIN LATERAL (
    SELECT u.first_cent,u.last_cent FROM crest.allocation_unapplications u
    JOIN crest.allocation_events a ON a.business_id=u.business_id AND a.id=u.allocation_id AND a.partition_id=l.parent_partition_id
    JOIN crest.financial_events e ON e.business_id=u.business_id AND e.unapplication_id=u.id AND e.template='P05'
    WHERE u.business_id=l.business_id AND u.id=l.unapplication_id
    UNION ALL
    SELECT p.first_cent,p.last_cent FROM crest.financial_events e
    JOIN crest.funding_origins o ON (o.business_id,o.payment_id,o.id,o.customer_id)=(e.business_id,e.payment_id,l.origin_id,l.customer_id)
    JOIN crest.funding_partitions p ON (p.business_id,p.origin_id,p.id)=(o.business_id,o.id,l.parent_partition_id)
    WHERE e.business_id=l.business_id AND e.id=coalesce(l.receipt_event_id,l.receipt_tip_event_id) AND e.template='P03'
    UNION ALL
    SELECT r.first_cent,r.last_cent FROM crest.collection_failure_recredits r
    JOIN crest.financial_events e ON e.business_id=r.business_id AND e.collection_failure_recredit_id=r.id AND e.template='P11'
    JOIN crest.collection_failures f ON f.business_id=r.business_id AND f.id=r.failure_id
    JOIN crest.funding_origins o ON (o.business_id,o.id,o.payment_id,o.customer_id)=(f.business_id,l.origin_id,f.payment_id,l.customer_id)
    WHERE e.business_id=l.business_id AND e.id=l.collection_failure_recredit_event_id
    UNION ALL
    SELECT c.first_cent,c.last_cent FROM crest.collection_failure_settlement_components c
    JOIN crest.collection_failure_settlements s ON (s.business_id,s.id)=(c.business_id,c.settlement_id)
    JOIN crest.financial_events e ON (e.business_id,e.collection_failure_settlement_id)=(s.business_id,s.id) AND e.template='P11'
    JOIN crest.collection_failures f ON (f.business_id,f.id)=(s.business_id,s.failure_id)
    JOIN crest.funding_origins o ON (o.business_id,o.id,o.payment_id,o.customer_id)=(f.business_id,l.origin_id,f.payment_id,l.customer_id)
    WHERE (c.business_id,c.id,c.parent_partition_id)=(l.business_id,l.collection_failure_settlement_component_id,l.parent_partition_id) AND c.receivable_id IS NULL
   ) s
  ), origins AS (
   SELECT business_id,id,count(*) AS n,min(first_cent) AS first_cent,max(last_cent) AS last_cent FROM sources GROUP BY business_id,id
  ), spent AS (
   SELECT c.*,max(c.last_cent::numeric) OVER(PARTITION BY c.business_id,c.fund_lot_id ORDER BY c.first_cent,c.last_cent,c.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_last
   FROM crest.fund_lot_range_consumptions c
  ) SELECT
   NOT EXISTS(SELECT 1 FROM crest.customer_fund_lots l
    LEFT JOIN origins s ON s.business_id=l.business_id AND s.id=l.id
    LEFT JOIN crest.funding_partitions p ON p.business_id=l.business_id AND p.id=l.parent_partition_id
    WHERE s.n IS DISTINCT FROM 1::bigint OR p.id IS NULL
     OR num_nonnulls(l.unapplication_id,l.receipt_event_id,l.receipt_tip_event_id,l.collection_failure_recredit_event_id,l.collection_failure_settlement_component_id)<>1
     OR s.first_cent<p.first_cent::numeric OR s.last_cent>p.last_cent::numeric OR s.last_cent<s.first_cent
     OR s.last_cent-s.first_cent+1 IS DISTINCT FROM l.original_cents::numeric)
   AND NOT EXISTS(SELECT 1 FROM spent c LEFT JOIN origins s ON s.business_id=c.business_id AND s.id=c.fund_lot_id
    WHERE s.n IS DISTINCT FROM 1::bigint OR c.first_cent::numeric<s.first_cent OR c.last_cent::numeric>s.last_cent OR c.first_cent<=0 OR c.last_cent<c.first_cent
     OR c.first_cent::numeric<=c.prior_last
     OR num_nonnulls(c.fund_application_id,c.tip_realization_id,c.service_refund_id,c.excess_return_id,c.collection_failure_component_id)<>1)
   AS valid`)).rows[0];require(ranges?.valid===true);
  const closure=(await query(`WITH targets AS (
   SELECT business_id,id,fund_lot_id,first_cent,last_cent,'application' AS kind FROM crest.customer_fund_applications
   UNION ALL SELECT business_id,id,fund_lot_id,first_cent,last_cent,'tip' FROM crest.tip_realizations WHERE restored_settlement_component_id IS NULL
   UNION ALL SELECT business_id,id,fund_lot_id,first_cent,last_cent,'refund' FROM crest.service_credit_refunds
   UNION ALL SELECT business_id,id,fund_lot_id,first_cent,last_cent,'return' FROM crest.excess_receipt_returns
   UNION ALL SELECT business_id,id,fund_lot_id,first_cent,last_cent,'failure' FROM crest.collection_failure_components WHERE fund_lot_id IS NOT NULL
  ), spent AS (
   SELECT c.*,coalesce(fund_application_id,tip_realization_id,service_refund_id,excess_return_id,collection_failure_component_id) AS target_id,
    CASE WHEN fund_application_id IS NOT NULL THEN 'application' WHEN tip_realization_id IS NOT NULL THEN 'tip' WHEN service_refund_id IS NOT NULL THEN 'refund' WHEN excess_return_id IS NOT NULL THEN 'return' ELSE 'failure' END AS kind
   FROM crest.fund_lot_range_consumptions c
  ) SELECT NOT EXISTS(SELECT 1 FROM spent c FULL JOIN targets t ON t.business_id=c.business_id AND t.id=c.target_id AND t.kind=c.kind
   WHERE c.id IS NULL OR t.id IS NULL OR (c.fund_lot_id,c.first_cent,c.last_cent) IS DISTINCT FROM (t.fund_lot_id,t.first_cent,t.last_cent))
   AND (SELECT count(*) FROM spent)=(SELECT count(*) FROM targets) AS valid`)).rows[0];require(closure?.valid===true);
  // Restored tips retain the first consumption; they must not consume the fund
  // lot again. Validate their ancestry rather than expecting a second record.
  const generations=(await query(`WITH RECURSIVE chain AS (
   SELECT t.business_id,t.id AS tip_id,t.id AS current_id,ARRAY[t.id] AS path,0 AS depth FROM crest.tip_realizations t WHERE t.restored_settlement_component_id IS NOT NULL
   UNION ALL
   SELECT g.business_id,g.tip_id,p.id,g.path||p.id,g.depth+1 FROM chain g
   JOIN crest.tip_realizations t ON t.business_id=g.business_id AND t.id=g.current_id
   JOIN crest.collection_failure_settlement_components c ON c.business_id=t.business_id AND c.id=t.restored_settlement_component_id
   JOIN crest.tip_realizations p ON p.business_id=c.business_id AND p.id=c.original_tip_realization_id
   WHERE g.depth<180 AND NOT(p.id=ANY(g.path))
  ), roots AS (
   SELECT g.business_id,g.tip_id,count(*) AS n FROM chain g JOIN crest.tip_realizations t ON t.business_id=g.business_id AND t.id=g.current_id
   WHERE t.restored_settlement_component_id IS NULL GROUP BY g.business_id,g.tip_id
  ) SELECT
   NOT EXISTS(SELECT 1 FROM crest.tip_realizations t LEFT JOIN roots r ON r.business_id=t.business_id AND r.tip_id=t.id
    WHERE t.restored_settlement_component_id IS NOT NULL AND r.n IS DISTINCT FROM 1::bigint)
   AND NOT EXISTS(SELECT 1 FROM crest.tip_realizations t
    LEFT JOIN crest.collection_failure_settlement_components c ON c.business_id=t.business_id AND c.id=t.restored_settlement_component_id
    LEFT JOIN crest.tip_realizations p ON p.business_id=c.business_id AND p.id=c.original_tip_realization_id
    LEFT JOIN crest.collection_failure_components f ON f.business_id=c.business_id AND f.id=c.failure_component_id
    LEFT JOIN crest.financial_events e ON e.business_id=c.business_id AND e.collection_failure_settlement_id=c.settlement_id AND e.template='P11' AND e.template_version=3
    WHERE t.restored_settlement_component_id IS NOT NULL AND (c.id IS NULL OR p.id IS NULL OR f.id IS NULL OR e.id IS NULL
     OR c.receivable_id IS NOT NULL OR c.original_tip_realization_id IS DISTINCT FROM f.tip_realization_id
     OR (t.fund_lot_id,t.first_cent,t.last_cent) IS DISTINCT FROM (p.fund_lot_id,c.first_cent,c.last_cent)
     OR t.first_cent<p.first_cent OR t.last_cent>p.last_cent))
   AND NOT EXISTS(SELECT 1 FROM crest.collection_failure_settlement_components c LEFT JOIN crest.tip_realizations t ON t.business_id=c.business_id AND t.restored_settlement_component_id=c.id
    WHERE c.original_tip_realization_id IS NOT NULL AND t.id IS NULL) AS valid`)).rows[0];require(generations?.valid===true);
  return Object.freeze({profile:'crest.funding-range-integrity.v1' as const,originalOffsetBoundsVerified:true as const,withinLotDisjointnessVerified:true as const,typedConsumptionClosureVerified:true as const,restoredTipAncestryVerified:true as const,fullBusinessReconciliationVerified:false as const,completeBackup:false as const});
 }catch{throw new RecoveryFundingRangeError();}
}
