import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountCode,financeAccountReviewReason,financeAccountTypes,requireFinanceAccount as check} from './finance-account-contract.ts';

const templates=['P01','P02','P03','P12'];
const nonnegative=(value:unknown):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(value);
const signed=(value:unknown):value is string=>nonnegative(value)||typeof value==='string'&&/^-[1-9][0-9]{0,29}$/.test(value);
const observedTimestamp=(value:unknown):value is string=>typeof value==='string'
  &&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(value)&&Number.isFinite(Date.parse(value));
const reportFields=['schemaVersion','businessId','currency','observedAt','throughOn','timeZone','coverageStart','coverage',
  'controls','postedEventCount'] as const;

function reportContext(value:Record<string,unknown>,businessId:string,throughOn:string|null){
  check(value.schemaVersion===1&&value.businessId===businessId&&value.currency==='USD'
    &&observedTimestamp(value.observedAt)&&customerDate(value.throughOn)&&(throughOn===null||throughOn===value.throughOn)
    &&typeof value.timeZone==='string'&&/^[A-Za-z_0-9+\-/]{1,80}$/.test(value.timeZone)
    &&(value.coverageStart===null||customerDate(value.coverageStart)&&value.coverageStart<=value.throughOn)
    &&nonnegative(value.postedEventCount)&&(value.coverageStart===null)===(value.postedEventCount==='0'));
  const {coverage,controls}=value;
  check(exact(coverage,['complete','openingBalancesIncluded','reconciliationVerified','templates'])
    &&coverage.complete===false&&coverage.openingBalancesIncluded===false&&coverage.reconciliationVerified===false
    &&Array.isArray(coverage.templates)&&coverage.templates.length===templates.length
    &&templates.every((template,index)=>coverage.templates instanceof Array&&coverage.templates[index]===template));
  check(exact(controls,['ledgerBalanced','receivablesTie','moneyMovementsTie'])
    &&controls.ledgerBalanced===true&&controls.receivablesTie===true&&controls.moneyMovementsTie===true);
  return {businessId,currency:'USD' as const,observedAt:value.observedAt,throughOn:value.throughOn,timeZone:value.timeZone,
    coverageStart:value.coverageStart,postedEventCount:value.postedEventCount};
}

export function parseFictionalTrialBalance(value:unknown,businessId:string,throughOn:string|null){
  check(exact(value,[...reportFields,'rows','totals'])&&Array.isArray(value.rows)&&value.rows.length<=5000);
  const context=reportContext(value,businessId,throughOn);
  const {totals}=value;
  check(exact(totals,['debitCents','creditCents','debitBalanceCents','creditBalanceCents'])
    &&nonnegative(totals.debitCents)&&nonnegative(totals.creditCents)
    &&nonnegative(totals.debitBalanceCents)&&nonnegative(totals.creditBalanceCents));
  const rows=value.rows.map((row:unknown)=>{
    check(exact(row,['accountId','code','name','accountType','normalSide','active','debitCents','creditCents','balanceCents'])
      &&customerUuid(row.accountId)&&financeAccountCode(row.code)&&financeAccountReviewReason(row.name)
      &&typeof row.accountType==='string'&&financeAccountTypes.some(type=>type===row.accountType)
      &&(row.normalSide==='debit'||row.normalSide==='credit')&&typeof row.active==='boolean'
      &&nonnegative(row.debitCents)&&nonnegative(row.creditCents)&&signed(row.balanceCents));
    check(BigInt(row.debitCents)-BigInt(row.creditCents)===BigInt(row.balanceCents));
    return {accountId:row.accountId,code:row.code,name:row.name,accountType:row.accountType,normalSide:row.normalSide,
      active:row.active,debitCents:row.debitCents,creditCents:row.creditCents,balanceCents:row.balanceCents};
  });
  const sums=rows.reduce((sum,row)=>{
    const balance=BigInt(row.balanceCents);
    sum.debit+=BigInt(row.debitCents);sum.credit+=BigInt(row.creditCents);
    if(balance>0n)sum.debitBalance+=balance;
    if(balance<0n)sum.creditBalance-=balance;
    return sum;
  },{debit:0n,credit:0n,debitBalance:0n,creditBalance:0n});
  check(new Set(rows.map(row=>row.accountId)).size===rows.length&&new Set(rows.map(row=>row.code)).size===rows.length
    &&sums.debit===sums.credit&&sums.debitBalance===sums.creditBalance
    &&sums.debit.toString()===totals.debitCents&&sums.credit.toString()===totals.creditCents
    &&sums.debitBalance.toString()===totals.debitBalanceCents&&sums.creditBalance.toString()===totals.creditBalanceCents);
  return {...context,rows,totals:{debitCents:totals.debitCents,creditCents:totals.creditCents,
      debitBalanceCents:totals.debitBalanceCents,creditBalanceCents:totals.creditBalanceCents}};
}

export const fictionalJournalPageSize=40;
const uuidOrNull=(value:unknown):value is string|null=>value===null||customerUuid(value);
export function parseFictionalJournal(value:unknown,businessId:string,throughOn:string,accountId:string|null,afterLineId:string|null){
  check(exact(value,[...reportFields,'rows','hasMore','nextAfterLineId'])
    &&Array.isArray(value.rows)&&value.rows.length<=fictionalJournalPageSize&&typeof value.hasMore==='boolean'
    &&uuidOrNull(value.nextAfterLineId)&&value.hasMore===(value.nextAfterLineId!==null));
  const context=reportContext(value,businessId,throughOn);
  const rows=value.rows.map((row:unknown)=>{
    check(exact(row,['lineId','eventId','entryId','effectiveOn','commitSequence','eventSequence','entrySequence','template',
      'purpose','accountId','code','name','debitCents','creditCents','runningBalanceCents','invoiceId','paymentId',
      'postedExpenseId','operationId'])
      &&customerUuid(row.lineId)&&customerUuid(row.eventId)&&customerUuid(row.entryId)&&customerUuid(row.operationId)
      &&customerDate(row.effectiveOn)&&row.effectiveOn<=throughOn&&nonnegative(row.commitSequence)
      &&nonnegative(row.eventSequence)&&nonnegative(row.entrySequence)&&typeof row.template==='string'&&templates.includes(row.template)
      &&typeof row.purpose==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(row.purpose)
      &&customerUuid(row.accountId)&&(accountId===null||row.accountId===accountId)&&financeAccountCode(row.code)
      &&financeAccountReviewReason(row.name)&&nonnegative(row.debitCents)&&nonnegative(row.creditCents)
      &&(row.debitCents==='0')!==(row.creditCents==='0')&&signed(row.runningBalanceCents)
      &&uuidOrNull(row.invoiceId)&&uuidOrNull(row.paymentId)&&uuidOrNull(row.postedExpenseId));
    return {lineId:row.lineId,eventId:row.eventId,entryId:row.entryId,effectiveOn:row.effectiveOn,commitSequence:row.commitSequence,
      eventSequence:row.eventSequence,entrySequence:row.entrySequence,template:row.template,purpose:row.purpose,accountId:row.accountId,
      code:row.code,name:row.name,debitCents:row.debitCents,creditCents:row.creditCents,runningBalanceCents:row.runningBalanceCents,
      invoiceId:row.invoiceId,paymentId:row.paymentId,postedExpenseId:row.postedExpenseId,operationId:row.operationId};
  });
  check(new Set(rows.map(row=>row.lineId)).size===rows.length&&rows.every(row=>row.lineId!==afterLineId)
    &&(!value.hasMore||rows.length===fictionalJournalPageSize&&rows.at(-1)?.lineId===value.nextAfterLineId));
  return {...context,rows,nextAfterLineId:value.nextAfterLineId};
}
