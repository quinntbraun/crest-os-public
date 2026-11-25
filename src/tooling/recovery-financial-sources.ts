// The sixteen issued/posted source roots required by the registered schema138
// contracts. Drafts are deliberately absent. Restored tips belong to their
// settlement event through components, checked by recovery-funding-ranges.
import {isLiveRecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
export class RecoveryFinancialSourcesError extends Error{constructor(){super('RECOVERY_FINANCIAL_SOURCES_REVIEW_REQUIRED');this.name='RecoveryFinancialSourcesError';}}
export async function verifyRecoveryFinancialSources(snapshot:RecoveryBackupSnapshot,signal:AbortSignal){
 try{
  if(!isLiveRecoveryBackupSnapshot(snapshot))throw new RecoveryFinancialSourcesError();signal.throwIfAborted();
  const mode=(await snapshot.query("SELECT current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation")).rows[0];
  if(mode?.read_only!=='on'||mode.isolation!=='repeatable read')throw new RecoveryFinancialSourcesError();
  const result=(await snapshot.query(`WITH sources AS (
   SELECT business_id,id,'invoice_id' AS kind FROM crest.invoices
   UNION ALL SELECT business_id,id,'payment_id' FROM crest.payments
   UNION ALL SELECT business_id,id,'posted_expense_id' FROM crest.posted_expenses
   UNION ALL SELECT business_id,id,'unapplication_id' FROM crest.allocation_unapplications
   UNION ALL SELECT business_id,id,'fund_application_id' FROM crest.customer_fund_applications
   UNION ALL SELECT business_id,id,'tip_realization_id' FROM crest.tip_realizations WHERE restored_settlement_component_id IS NULL
   UNION ALL SELECT business_id,id,'invoice_credit_id' FROM crest.invoice_credits
   UNION ALL SELECT business_id,id,'service_refund_id' FROM crest.service_credit_refunds
   UNION ALL SELECT business_id,id,'excess_return_id' FROM crest.excess_receipt_returns
   UNION ALL SELECT business_id,id,'tip_return_id' FROM crest.tip_returns
   UNION ALL SELECT business_id,id,'collection_failure_id' FROM crest.collection_failures
   UNION ALL SELECT business_id,id,'refund_transfer_adjustment_id' FROM crest.refund_transfer_adjustments
   UNION ALL SELECT business_id,id,'collection_failure_recredit_id' FROM crest.collection_failure_recredits
   UNION ALL SELECT business_id,id,'collection_failure_settlement_id' FROM crest.collection_failure_settlements
   UNION ALL SELECT business_id,id,'supplier_payable_id' FROM crest.supplier_payables
   UNION ALL SELECT business_id,id,'supplier_payable_settlement_id' FROM crest.supplier_payable_settlements
  ), event_sources AS (
   SELECT e.business_id,e.id AS event_id,r.kind,r.source_id FROM crest.financial_events e
   CROSS JOIN LATERAL (VALUES
    ('invoice_id',e.invoice_id),('payment_id',e.payment_id),('posted_expense_id',e.posted_expense_id),
    ('unapplication_id',e.unapplication_id),('fund_application_id',e.fund_application_id),('tip_realization_id',e.tip_realization_id),
    ('invoice_credit_id',e.invoice_credit_id),('service_refund_id',e.service_refund_id),('excess_return_id',e.excess_return_id),
    ('tip_return_id',e.tip_return_id),('collection_failure_id',e.collection_failure_id),('refund_transfer_adjustment_id',e.refund_transfer_adjustment_id),
    ('collection_failure_recredit_id',e.collection_failure_recredit_id),('collection_failure_settlement_id',e.collection_failure_settlement_id),
    ('supplier_payable_id',e.supplier_payable_id),('supplier_payable_settlement_id',e.supplier_payable_settlement_id)
   ) r(kind,source_id) WHERE r.source_id IS NOT NULL
  ) SELECT
   NOT EXISTS(SELECT 1 FROM sources s LEFT JOIN event_sources r ON (r.business_id,r.kind,r.source_id)=(s.business_id,s.kind,s.id)
    GROUP BY s.business_id,s.kind,s.id HAVING count(r.event_id)<>1)
   AND NOT EXISTS(SELECT 1 FROM event_sources r LEFT JOIN sources s ON (s.business_id,s.kind,s.id)=(r.business_id,r.kind,r.source_id) WHERE s.id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM crest.financial_events e WHERE NOT EXISTS(SELECT 1 FROM event_sources r WHERE (r.business_id,r.event_id)=(e.business_id,e.id)))
   AS valid`)).rows[0];
  signal.throwIfAborted();if(!isLiveRecoveryBackupSnapshot(snapshot)||result?.valid!==true)throw new RecoveryFinancialSourcesError();
 }catch{throw new RecoveryFinancialSourcesError();}
}
