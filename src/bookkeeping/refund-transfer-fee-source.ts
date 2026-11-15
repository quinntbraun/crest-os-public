import {createHash} from 'node:crypto';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const feeFields = ['id','business_id','adjustment_id','mapping_id','fee_account_id','net_cents','cents','confirmation','component_evidence_id'] as const;
const evidenceFields = ['id','business_id','provider_namespace','external_account_id','id_namespace','external_id','raw_reference',
  'normalization_rule','confirmed_on','signed_cents','currency'] as const;
type Row = Readonly<Record<string, unknown>>;
type SourceRow = Readonly<Record<string, string | null>>;

export const refundTransferFeeSourceCoverage = Object.freeze({
  table:'crest.refund_transfer_embedded_fees',scope:'business' as const,required:feeFields,excluded:[],partialEvidenceGroup:null,
});

function check(value: unknown): asserts value {
  if (!value) throw Error('REFUND_TRANSFER_FEE_SOURCE_REVIEW_REQUIRED');
}

export function isRefundTransferFeeOperation(row: Row) {
  return row.command_type === 'finance.refund.adjust_transfer' && row.state === 'committed'
    && typeof row.result === 'string' && JSON.parse(row.result)?.schemaVersion === 2;
}

function sourceRows(input: unknown, columns: readonly string[], businessId: string) {
  check(Array.isArray(input) && input.length <= 1000);
  let prior = '';
  return input.map((row: unknown) => {
    check(exact(row,columns) && row.business_id === businessId && customerUuid(row.id) && row.id > prior
      && Object.values(row).every(cell => cell === null || typeof cell === 'string'));
    prior = row.id;
    return row as SourceRow;
  });
}

export async function captureRefundTransferFeeSource(businessId: string, historySnapshotToken: string,
  query: (sql:string,args:unknown[]) => Promise<unknown[]>) {
  const result = await query('SELECT crest_commands.refund_transfer_fee_source_snapshot($1::uuid) AS result',[businessId]);
  check(result.length === 1 && exact(result[0],['result']));
  const source = result[0].result;
  check(exact(source,['schemaVersion','businessId','historySnapshotToken','fees','components']) && source.schemaVersion === 1
    && source.businessId === businessId && source.historySnapshotToken === historySnapshotToken
    && /^[a-f0-9]{64}$/.test(historySnapshotToken) && Buffer.byteLength(JSON.stringify(source)) <= 4 * 1024 * 1024 + 512);
  const fees = sourceRows(source.fees,feeFields,businessId);
  const components = sourceRows(source.components,evidenceFields,businessId);
  check(fees.every(fee => customerUuid(fee.adjustment_id) && customerUuid(fee.mapping_id) && customerUuid(fee.fee_account_id)
    && isFinanceCents(fee.net_cents) && fee.net_cents !== '0' && isFinanceCents(fee.cents) && fee.cents !== '0'
    && typeof fee.confirmation === 'string' && fee.confirmation.length > 0 && fee.confirmation.length <= 1000
    && (fee.component_evidence_id === null || customerUuid(fee.component_evidence_id))));
  const declared = fees.filter(fee => fee.component_evidence_id !== null).map(fee => fee.component_evidence_id);
  check(declared.length === components.length && new Set(declared).size === declared.length
    && components.every(component => declared.includes(component.id)));
  const snapshotToken = createHash('sha256').update('crest.refund-transfer-fee-source.v1:' + historySnapshotToken).digest('hex');
  return {fees,components,snapshotToken};
}
