import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {moneyChannelCents} from './finance-money-channel-contract.ts';
import type {MoneyChannel} from './finance-money-channel-contract.ts';

type Account = Readonly<Pick<MoneyChannel,'accountId'|'kind'|'ownershipScope'|'active'>>;
type TimingSource = Readonly<{
  id:string;
  accountId:string;
  kind:'money_movement'|'approved_opening';
  effectiveOn:string;
  signedCents:string;
  clearances:readonly Readonly<{id:string;clearedOn:string;signedCents:string}>[];
}>;

const evidenceFields=['id','accountId','startsOn','endsOn','openingCents','closingCents','fileSha256',
  'providerDateConvention','completenessEvidence','rows'] as const;
const rowFields=['id','statementOn','signedCents'] as const;
const timingFields=['sourceId','expectedClearOn','evidence'] as const;

function requireValues(condition:unknown):asserts condition {
  if(!condition)throw Error('STATEMENT_RECONCILIATION_REVIEW_REQUIRED');
}

const nonzero=(value:unknown):value is string=>moneyChannelCents(value)&&value!=='0';

export function assessStatementRows(
  interval:Readonly<{startsOn:string;endsOn:string;openingCents:string;closingCents:string}>,rows:readonly unknown[],
){
  const {startsOn,endsOn}=interval;
  requireValues(customerDate(startsOn)&&customerDate(endsOn)&&startsOn<=endsOn
    &&moneyChannelCents(interval.openingCents)&&moneyChannelCents(interval.closingCents));
  const rowIds=new Set<string>();
  let rowTotal=0n;
  for(const row of rows){
    requireValues(exact(row,rowFields)&&customerUuid(row.id)&&!rowIds.has(row.id)&&customerDate(row.statementOn)
      &&row.statementOn>=startsOn&&row.statementOn<=endsOn&&nonzero(row.signedCents));
    rowIds.add(row.id);
    rowTotal+=BigInt(row.signedCents);
  }
  return {rowTotal,difference:BigInt(interval.closingCents)-BigInt(interval.openingCents)-rowTotal};
}

/**
 * Assess the signed arithmetic of a complete, normalized statement draft.
 * The account, ledger balance, and referenced source records come from the
 * same authorized database snapshot. This routine never approves a reconciliation.
 */
export function assessDedicatedStatementValues(
  account:Account,ledgerBalance:Readonly<{accountId:string;throughOn:string;signedCents:string}>,
  evidence:unknown,timingItems:unknown,readTimingSource:(id:string)=>TimingSource|undefined,
) {
  requireValues(account.active&&customerUuid(account.accountId)&&(account.kind==='bank'||account.kind==='wallet')
    &&account.ownershipScope==='dedicated_business');
  requireValues(exact(evidence,evidenceFields)&&customerUuid(evidence.id)&&evidence.accountId===account.accountId
    &&customerDate(evidence.startsOn)&&customerDate(evidence.endsOn)&&evidence.startsOn<=evidence.endsOn
    &&moneyChannelCents(evidence.openingCents)&&moneyChannelCents(evidence.closingCents)
    &&typeof evidence.fileSha256==='string'&&/^[a-f0-9]{64}$/.test(evidence.fileSha256)
    &&financeAccountReviewReason(evidence.providerDateConvention)&&financeAccountReviewReason(evidence.completenessEvidence)
    &&Array.isArray(evidence.rows)&&Array.isArray(timingItems)
    &&ledgerBalance.accountId===account.accountId&&ledgerBalance.throughOn===evidence.endsOn&&moneyChannelCents(ledgerBalance.signedCents));
  const {endsOn}=evidence;
  const {rowTotal,difference:statementDifference}=assessStatementRows({
    startsOn:evidence.startsOn,endsOn,openingCents:evidence.openingCents,closingCents:evidence.closingCents,
  },evidence.rows);

  const sourceIds=new Set<string>(),clearanceIds=new Set<string>();
  let outstanding=0n;
  for(const item of timingItems as unknown[]){
    requireValues(exact(item,timingFields)&&customerUuid(item.sourceId)&&!sourceIds.has(item.sourceId)
      &&financeAccountReviewReason(item.evidence)&&customerDate(item.expectedClearOn));
    sourceIds.add(item.sourceId);
    const source=readTimingSource(item.sourceId);
    requireValues(source&&source.id===item.sourceId&&source.accountId===account.accountId
      &&(source.kind==='money_movement'||source.kind==='approved_opening')&&customerDate(source.effectiveOn)
      &&source.effectiveOn<=endsOn&&item.expectedClearOn>=source.effectiveOn&&nonzero(source.signedCents));
    const signed=BigInt(source.signedCents),direction=signed>0n?1n:-1n;
    let cleared=0n,clearedThrough=0n;
    for(const clearance of source.clearances){
      requireValues(customerUuid(clearance.id)&&!clearanceIds.has(clearance.id)
        &&customerDate(clearance.clearedOn)&&clearance.clearedOn>=source.effectiveOn&&nonzero(clearance.signedCents));
      clearanceIds.add(clearance.id);
      const amount=BigInt(clearance.signedCents);
      requireValues(amount*direction>0n);
      cleared+=amount;
      if(clearance.clearedOn<=endsOn)clearedThrough+=amount;
    }
    requireValues((signed-cleared)*direction>=0n);
    outstanding+=signed-clearedThrough;
  }
  const ledgerDifference=BigInt(ledgerBalance.signedCents)-(BigInt(evidence.closingCents)+outstanding);
  return Object.freeze({
    state:statementDifference===0n&&ledgerDifference===0n?'arithmetic_balanced':'needs_review',
    statementRowTotalCents:String(rowTotal),
    statementDifferenceCents:String(statementDifference),
    outstandingTimingCents:String(outstanding),
    ledgerDifferenceCents:String(ledgerDifference),
  } as const);
}
