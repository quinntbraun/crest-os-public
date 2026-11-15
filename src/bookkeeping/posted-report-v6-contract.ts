import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireFinanceAccount as check} from './finance-account-contract.ts';
import {fictionalJournalV5PageSize,parseFictionalJournalV5,parseFictionalTrialBalanceV5} from './posted-report-v5-contract.ts';

const previousTemplates=['P01','P02','P03','P04','P05','P06','P07','P12'];
const templates=Object.freeze(['P01','P02','P03','P04','P05','P06','P07','P08','P12'] as const);
export const fictionalJournalV6PageSize=fictionalJournalV5PageSize;

function projectReport(value:unknown){
  check(value!==null&&typeof value==='object'&&!Array.isArray(value));
  const report=value as Record<string,unknown>,coverage=report.coverage;
  check(report.schemaVersion===6&&exact(coverage,['complete','openingBalancesIncluded','reconciliationVerified','templates'])
    &&Array.isArray(coverage.templates)&&coverage.templates.length===templates.length
    &&templates.every((template,index)=>(coverage.templates as unknown[])[index]===template));
  return {...report,schemaVersion:5,coverage:{...coverage,templates:previousTemplates}};
}

export function parseFictionalTrialBalanceV6(value:unknown,businessId:string,throughOn:string|null){
  const report=parseFictionalTrialBalanceV5(projectReport(value),businessId,throughOn);
  return {...report,schemaVersion:6 as const,coverage:{...report.coverage,templates}};
}

function projectRow(value:unknown){
  check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'serviceRefundId'));
  const {serviceRefundId,...row}=value as Record<string,unknown>;
  if(row.template!=='P08'){
    check(serviceRefundId===null);
    if(row.template==='P03'&&row.purpose==='receipt_funds'){
      check(row.code==='2000'&&row.debitCents==='0'&&customerUuid(row.fundLotId));
      return {row:{...row,purpose:'receipt_ar',fundLotId:null},refund:null,held:row.fundLotId};
    }
    return {row,refund:null,held:null};
  }
  const {purpose,fundLotId}=row;
  check(customerUuid(serviceRefundId)&&row.invoiceId===null&&row.paymentId===null&&row.postedExpenseId===null
    &&row.unapplicationId===null&&row.fundApplicationId===null&&row.tipRealizationId===null&&row.invoiceCreditId===null);
  check(purpose==='refund_funds'&&row.code==='2000'&&customerUuid(fundLotId)&&row.creditCents==='0'
    ||purpose==='refund_money'&&fundLotId===null&&row.debitCents==='0');
  return {row:{...row,template:'P03',purpose:purpose==='refund_funds'?'receipt_money':'receipt_ar',
    paymentId:serviceRefundId,fundLotId:null},refund:{serviceRefundId,purpose,fundLotId},held:null};
}

export function parseFictionalJournalV6(value:unknown,businessId:string,throughOn:string,accountId:string|null,
    afterLineId:string|null,pageSize=fictionalJournalV6PageSize){
  const projected=projectReport(value);
  check(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=100
    &&'rows' in projected&&Array.isArray(projected.rows)&&projected.rows.length<=pageSize);
  const candidates=projected.rows.map(projectRow);
  const report=parseFictionalJournalV5({...projected,rows:candidates.map(item=>item.row)},businessId,throughOn,accountId,afterLineId,pageSize);
  const rows=report.rows.map((row,index)=>{
    const {refund,held}=candidates[index]!;
    if(held!==null){
      check(row.template==='P03');
      return {...row,purpose:'receipt_funds' as const,fundLotId:held,serviceRefundId:null};
    }
    return refund===null?{...row,serviceRefundId:null}:{...row,...refund,template:'P08' as const,paymentId:null};
  });
  type RefundLine=Extract<(typeof rows)[number],{template:'P08'}>;
  const byRefund=new Map<string,RefundLine[]>(),byEvent=new Map<string,string|null>();
  const heldEvents=new Set<string>();
  for(const row of rows){
    if(row.purpose==='receipt_funds'){
      check(!heldEvents.has(row.eventId));
      heldEvents.add(row.eventId);
    }
    const previous=byEvent.get(row.eventId);
    check(previous===undefined||previous===row.serviceRefundId);
    byEvent.set(row.eventId,row.serviceRefundId);
    if(row.template!=='P08')continue;
    const siblings=byRefund.get(row.serviceRefundId)??[];
    check(siblings.every(other=>other.purpose!==row.purpose&&other.eventId===row.eventId&&other.entryId===row.entryId
      &&other.operationId===row.operationId&&other.effectiveOn===row.effectiveOn&&other.commitSequence===row.commitSequence
      &&other.eventSequence===row.eventSequence&&other.entrySequence===row.entrySequence&&other.accountId!==row.accountId));
    siblings.push(row);byRefund.set(row.serviceRefundId,siblings);
  }
  if(accountId===null&&afterLineId===null&&!report.hasMore)for(const lines of byRefund.values()){
    check(lines.length===2&&lines.reduce((total,line)=>total+BigInt(line.debitCents)-BigInt(line.creditCents),0n)===0n);
  }
  return {...report,schemaVersion:6 as const,coverage:{...report.coverage,templates},rows};
}

export type FictionalJournalV6=ReturnType<typeof parseFictionalJournalV6>;
export type FictionalTrialBalanceV6=ReturnType<typeof parseFictionalTrialBalanceV6>;
