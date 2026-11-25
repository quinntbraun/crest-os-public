// Read-only checks of ACCOUNTING original receipt-root/partition invariants.
// No security-definer execution, new grants, financial posting or repair.
import {isLiveRecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
export class RecoveryFundingRootError extends Error{
 constructor(){super('RECOVERY_FUNDING_ROOT_REVIEW_REQUIRED');this.name='RecoveryFundingRootError';}
}
function require(value:unknown):asserts value{if(!value)throw new RecoveryFundingRootError();}
export async function verifyRecoveryFundingRoots(snapshot:RecoveryBackupSnapshot,signal:AbortSignal){
 try{
  require(isLiveRecoveryBackupSnapshot(snapshot));signal.throwIfAborted();
  const mode=(await snapshot.query("SELECT current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation")).rows[0];require(mode?.read_only==='on'&&mode.isolation==='repeatable read');
  const payments=(await snapshot.query(`SELECT
   NOT EXISTS(SELECT 1 FROM crest.funding_origins r LEFT JOIN crest.payments p ON p.business_id=r.business_id AND p.id=r.payment_id
    WHERE p.id IS NULL OR r.cents<=0 OR r.currency IS DISTINCT FROM 'USD' OR r.cents IS DISTINCT FROM p.gross_cents OR r.customer_id IS DISTINCT FROM p.customer_id)
   AND NOT EXISTS(SELECT 1 FROM crest.payments p LEFT JOIN crest.funding_origins r ON r.business_id=p.business_id AND r.payment_id=p.id WHERE r.id IS NULL)
   AND (SELECT count(*) FROM crest.funding_origins)=(SELECT count(*) FROM crest.payments)
   AS valid`)).rows[0];require(payments?.valid===true);signal.throwIfAborted();require(isLiveRecoveryBackupSnapshot(snapshot));
  const partitions=(await snapshot.query(`WITH ordered AS (
   SELECT p.*,row_number() OVER(PARTITION BY p.business_id,p.origin_id ORDER BY p.position,p.id) AS ordinal,
    lag(p.last_cent::numeric,1,0::numeric) OVER(PARTITION BY p.business_id,p.origin_id ORDER BY p.position,p.id) AS prior
   FROM crest.funding_partitions p
  ) SELECT
   NOT EXISTS(SELECT 1 FROM ordered p LEFT JOIN crest.funding_origins r ON r.business_id=p.business_id AND r.id=p.origin_id
    WHERE r.id IS NULL OR p.position IS DISTINCT FROM p.ordinal OR p.position NOT BETWEEN 1 AND 180 OR p.first_cent<=0 OR p.last_cent<p.first_cent
     OR p.first_cent::numeric<>p.prior+1 OR p.last_cent>r.cents)
   AND NOT EXISTS(SELECT 1 FROM crest.funding_origins r LEFT JOIN (
    SELECT business_id,origin_id,count(*) AS n,max(last_cent) AS last_cent,sum(last_cent::numeric-first_cent::numeric+1) AS cents
    FROM crest.funding_partitions GROUP BY business_id,origin_id
   ) p ON p.business_id=r.business_id AND p.origin_id=r.id WHERE p.n IS NULL OR p.last_cent IS DISTINCT FROM r.cents OR p.cents IS DISTINCT FROM r.cents::numeric)
   AS valid`)).rows[0];require(partitions?.valid===true);signal.throwIfAborted();require(isLiveRecoveryBackupSnapshot(snapshot));
  // Restored/recredited lots may reuse an original root. Do not demand that
  // descendants form a new root or that their original amounts sum to a root.
  const lots=(await snapshot.query(`SELECT NOT EXISTS(
   SELECT 1 FROM crest.customer_fund_lots l
   LEFT JOIN crest.funding_origins r ON r.business_id=l.business_id AND r.id=l.origin_id
   LEFT JOIN crest.funding_partitions p ON p.business_id=l.business_id AND p.id=l.parent_partition_id
   WHERE r.id IS NULL OR p.id IS NULL OR p.origin_id IS DISTINCT FROM r.id OR l.customer_id IS DISTINCT FROM r.customer_id
    OR l.original_cents<=0 OR l.original_cents::numeric>p.last_cent::numeric-p.first_cent::numeric+1
  ) AS valid`)).rows[0];require(lots?.valid===true);signal.throwIfAborted();require(isLiveRecoveryBackupSnapshot(snapshot));
  return Object.freeze({profile:'crest.funding-root-integrity.v1' as const,paymentRootClosureVerified:true as const,originalPartitionClosureVerified:true as const,fundLotRootLineageVerified:true as const,fullBusinessReconciliationVerified:false as const,completeBackup:false as const});
 }catch{throw new RecoveryFundingRootError();}
}
