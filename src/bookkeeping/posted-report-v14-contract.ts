import {customerUuid} from '../customer/customer-contract.ts';
import {requireFinanceAccount as check} from './finance-account-contract.ts';
import {fictionalJournalV13PageSize,parseFictionalJournalV13} from './posted-report-v13-contract.ts';

export const fictionalJournalV14PageSize=fictionalJournalV13PageSize;

const fields=['collectionFailureSettlementId','collectionFailureSettlementComponentId','settledFailureId',
  'settledFailureComponentId','settledPaymentId'] as const;
type Source = {collectionFailureSettlementId:string;settledFailureId:string;settledPaymentId:string} & (
  {purpose:'collection_settlement_money';collectionFailureSettlementComponentId:null;settledFailureComponentId:null;fundLotId:null} |
  {purpose:'collection_settlement_ar'|'collection_settlement_funds';collectionFailureSettlementComponentId:string;
    settledFailureComponentId:string;fundLotId:string|null}
);

function project(value:unknown){
  check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&fields.every(field=>Object.hasOwn(value,field)));
  const {collectionFailureSettlementId,collectionFailureSettlementComponentId,settledFailureId,settledFailureComponentId,
    settledPaymentId,...row}=value as Record<string,unknown>;
  if(collectionFailureSettlementId===null){
    check([collectionFailureSettlementComponentId,settledFailureId,settledFailureComponentId,settledPaymentId].every(item=>item===null));
    return {row,source:null};
  }
  check(customerUuid(collectionFailureSettlementId)&&customerUuid(settledFailureId)&&customerUuid(settledPaymentId)
    &&row.template==='P11'&&['invoiceId','paymentId','postedExpenseId','unapplicationId','fundApplicationId','tipRealizationId',
      'invoiceCreditId','serviceRefundId','excessReturnId','tipReturnId','collectionFailureId','collectionFailureComponentId',
      'collectionFailureKind','originalPaymentId','refundTransferAdjustmentId','refundTransferKind','priorRefundEventId','originalRefundEventId',
      'collectionFailureRecreditId','recreditedFailureId','recreditedFailureComponentId','recreditedPaymentId'].every(field=>row[field]===null));
  const {purpose,fundLotId,code,debitCents,creditCents}=row;
  const header={collectionFailureSettlementId,settledFailureId,settledPaymentId};
  let source:Source;
  if(purpose==='collection_settlement_money'){
    check(collectionFailureSettlementComponentId===null&&settledFailureComponentId===null&&fundLotId===null&&creditCents==='0');
    source={...header,purpose,collectionFailureSettlementComponentId,settledFailureComponentId,fundLotId};
  }else{
    check(customerUuid(collectionFailureSettlementComponentId)&&customerUuid(settledFailureComponentId)&&debitCents==='0'
      &&(purpose==='collection_settlement_ar'&&code==='1100'&&fundLotId===null
      ||purpose==='collection_settlement_funds'&&code==='2000'&&customerUuid(fundLotId)));
    source={...header,purpose,collectionFailureSettlementComponentId,settledFailureComponentId,fundLotId};
  }
  return {source,row:{...row,template:'P03',paymentId:collectionFailureSettlementId,fundLotId:null,
    purpose:purpose==='collection_settlement_money'?'receipt_money':'receipt_ar'}};
}

export function parseFictionalJournalV14(input:unknown,businessId:string,throughOn:string,accountId:string|null,afterLineId:string|null,
  pageSize=fictionalJournalV14PageSize){
  check(input!==null&&typeof input==='object'&&!Array.isArray(input));
  const report=input as Record<string,unknown>;
  check(report.schemaVersion===14&&Array.isArray(report.rows)&&report.rows.length<=pageSize);
  const candidates=report.rows.map(project);
  const prior=parseFictionalJournalV13({...report,schemaVersion:13,rows:candidates.map(item=>item.row)},businessId,throughOn,accountId,afterLineId,pageSize);
  const rows=prior.rows.map((row,index)=>{
    const {source}=candidates[index]!;
    if(source===null)return {...row,collectionFailureSettlementId:null,collectionFailureSettlementComponentId:null,
      settledFailureId:null,settledFailureComponentId:null,settledPaymentId:null};
    check(row.template==='P03'&&row.paymentId===source.collectionFailureSettlementId);
    return {...row,...source,template:'P11' as const,paymentId:null};
  });
  type Row=Extract<(typeof rows)[number],{collectionFailureSettlementId:string}>;
  const events=new Map<string,string|null>(), settlements=new Map<string,Row[]>(), allComponents=new Set<string>();
  for(const row of rows){
    const event=events.get(row.eventId);
    check(event===undefined||event===row.collectionFailureSettlementId);
    events.set(row.eventId,row.collectionFailureSettlementId);
    if(row.collectionFailureSettlementId===null)continue;
    const peers=settlements.get(row.collectionFailureSettlementId)??[];
    const first=peers[0];
    if(first)check(first.eventId===row.eventId&&first.entryId===row.entryId&&first.operationId===row.operationId
      &&first.settledFailureId===row.settledFailureId&&first.settledPaymentId===row.settledPaymentId
      &&first.effectiveOn===row.effectiveOn&&first.commitSequence===row.commitSequence&&first.eventSequence===row.eventSequence
      &&first.entrySequence===row.entrySequence);
    if(row.collectionFailureSettlementComponentId===null)check(!peers.some(peer=>peer.collectionFailureSettlementComponentId===null));
    else{
      check(!allComponents.has(row.collectionFailureSettlementComponentId));
      allComponents.add(row.collectionFailureSettlementComponentId);
    }
    peers.push(row);
    settlements.set(row.collectionFailureSettlementId,peers);
  }
  if(accountId===null&&afterLineId===null&&!prior.hasMore)for(const peers of settlements.values()){
    check(peers.length>=2&&peers.some(row=>row.purpose==='collection_settlement_money')
      &&peers.reduce((balance,row)=>balance+BigInt(row.debitCents)-BigInt(row.creditCents),0n)===0n);
  }
  return {...prior,schemaVersion:14 as const,rows};
}
export type FictionalJournalV14=ReturnType<typeof parseFictionalJournalV14>;
