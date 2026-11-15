import { customerDate, customerInstant, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { financeAccountCode, financeAccountReviewReason, requireFinanceAccount as check } from './finance-account-contract.ts';

export const incomeSections = {
  service_revenue: 'Gross service revenue',
  discounts: 'Discounts',
  returns: 'Returns and credits',
  other_contra_revenue: 'Other revenue reductions',
  tips_revenue: 'Net tips',
  other_income: 'Other income',
  expense: 'Expenses',
} as const;
type Section = keyof typeof incomeSections;
const reportFields = ['schemaVersion','businessId','currency','timeZone','observedAt','fromOn','throughOn',
  'coverageStart','coverage','controls','rows','netIncomeCents'] as const;
const controlFields = ['ledgerBalanced','receivablesTie','moneyMovementsTie','customerFundsTie','taxPayableTie'] as const;
const nonnegative = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(value);
const signed = (value: unknown): value is string => nonnegative(value) || typeof value === 'string' && /^-[1-9][0-9]{0,29}$/.test(value);

export function parseRecordedIncomeStatement(value: unknown,businessId:string,fromOn:string,throughOn:string) {
  check(exact(value,reportFields) && value.schemaVersion===1 && value.businessId===businessId && customerUuid(businessId)
    && value.currency==='USD' && typeof value.timeZone==='string' && /^[A-Za-z_0-9+\-/]{1,80}$/.test(value.timeZone)
    && customerInstant(value.observedAt) && customerDate(fromOn) && customerDate(throughOn)
    && value.fromOn===fromOn && value.throughOn===throughOn && fromOn<=throughOn
    && (value.coverageStart===null || customerDate(value.coverageStart) && value.coverageStart<=throughOn)
    && Array.isArray(value.rows) && value.rows.length<=5000 && signed(value.netIncomeCents));
  const {coverage,controls}=value;
  check(exact(coverage,['complete','openingBalancesIncluded','reconciliationVerified','templates'])
    && coverage.complete===false && coverage.openingBalancesIncluded===false && coverage.reconciliationVerified===false
    && Array.isArray(coverage.templates) && coverage.templates.length===12
    && coverage.templates.every((template,index)=>template==='P'+String(index+1).padStart(2,'0'))
    && exact(controls,controlFields) && controlFields.every(key=>controls[key]===true));
  const rows=value.rows.map((row:unknown)=>{
    check(exact(row,['section','accountId','code','name','active','debitCents','creditCents','incomeCents'])
      && typeof row.section==='string' && Object.hasOwn(incomeSections,row.section)
      && customerUuid(row.accountId) && financeAccountCode(row.code) && financeAccountReviewReason(row.name)
      && typeof row.active==='boolean' && nonnegative(row.debitCents) && nonnegative(row.creditCents) && signed(row.incomeCents)
      && BigInt(row.creditCents)-BigInt(row.debitCents)===BigInt(row.incomeCents));
    return {section:row.section as Section, accountId:row.accountId, code:row.code, name:row.name,active:row.active,
      debitCents:row.debitCents,creditCents:row.creditCents,incomeCents:row.incomeCents};
  });
  check(new Set(rows.map(row=>row.accountId)).size===rows.length
    && new Set(rows.map(row=>row.code)).size===rows.length
    && rows.reduce((sum,row)=>sum+BigInt(row.incomeCents),0n)===BigInt(value.netIncomeCents));
  return {schemaVersion:1 as const,businessId,currency:'USD' as const,timeZone:value.timeZone,observedAt:value.observedAt,
    fromOn,throughOn,coverageStart:value.coverageStart,rows,netIncomeCents:value.netIncomeCents};
}
