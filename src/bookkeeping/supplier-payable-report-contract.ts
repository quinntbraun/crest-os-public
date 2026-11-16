import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireFinanceAccount as check} from './finance-account-contract.ts';
import {parseFictionalTrialBalanceV10} from './posted-report-v10-contract.ts';
import {fictionalJournalV15PageSize,parseFictionalJournalV15} from './posted-report-v15-contract.ts';

const priorTemplates=Array.from({length:12},(_,index)=>'P'+String(index+1).padStart(2,'0'));
const templates=[...priorTemplates,'P14','P15'];
const supplierFields=['supplierPayableId','supplierBillId','supplierSettlementId','supplierMoneyMovementId'] as const;
const supplierControl={supplierPayablesTie:true as const};

export function projectSupplierReport(input:unknown,version:number,priorVersion:number){
 check(input!==null&&typeof input==='object'&&!Array.isArray(input));
 const {coverage,controls,...report}=input as Record<string,unknown>;
 check(report.schemaVersion===version&&exact(coverage,['complete','openingBalancesIncluded','reconciliationVerified','templates'])
  &&Array.isArray(coverage.templates)&&coverage.templates.length===templates.length
  &&templates.every((template,index)=>(coverage.templates as unknown[])[index]===template)
  &&controls!==null&&typeof controls==='object'&&!Array.isArray(controls));
 const {supplierPayablesTie,...priorControls}=controls as Record<string,unknown>;
 check(supplierPayablesTie===true);
 return {...report,schemaVersion:priorVersion,coverage:{...coverage,templates:priorTemplates},controls:priorControls};
}

export function parseFictionalTrialBalanceV11(input:unknown,businessId:string,throughOn:string|null){
 const report=parseFictionalTrialBalanceV10(projectSupplierReport(input,11,10),businessId,throughOn);
 return {...report,schemaVersion:11 as const,coverage:{...report.coverage,templates},controls:{...report.controls,...supplierControl}};
}

type SupplierLine = {supplierPayableId:string;supplierBillId:string} & (
 {template:'P14';purpose:'supplier_bill_cost'|'supplier_bill_payable';supplierSettlementId:null;supplierMoneyMovementId:null} |
 {template:'P15';purpose:'supplier_settlement_payable';supplierSettlementId:string;supplierMoneyMovementId:null} |
 {template:'P15';purpose:'supplier_settlement_money';supplierSettlementId:string;supplierMoneyMovementId:string}
);

function projectJournalRow(input:unknown){
 check(input!==null&&typeof input==='object'&&!Array.isArray(input)&&supplierFields.every(field=>Object.hasOwn(input,field)));
 const {supplierPayableId,supplierBillId,supplierSettlementId,supplierMoneyMovementId,...row}=input as Record<string,unknown>;
 const {template,purpose,code,debitCents,creditCents}=row;
 if(template!=='P14'&&template!=='P15'){
  check([supplierPayableId,supplierBillId,supplierSettlementId,supplierMoneyMovementId].every(field=>field===null));
  return {row,supplier:null};
 }
 check(customerUuid(supplierPayableId)&&customerUuid(supplierBillId)&&row.paymentId===null);
 const payable={supplierPayableId,supplierBillId};
 let supplier:SupplierLine;
 if(template==='P14'){
  check(supplierSettlementId===null&&supplierMoneyMovementId===null
   &&(purpose==='supplier_bill_cost'&&creditCents==='0'&&code!=='2200'
    ||purpose==='supplier_bill_payable'&&debitCents==='0'&&code==='2200'));
  supplier={...payable,template,purpose,supplierSettlementId,supplierMoneyMovementId};
 }else{
  check(customerUuid(supplierSettlementId));
  if(purpose==='supplier_settlement_payable'){
   check(code==='2200'&&creditCents==='0'&&supplierMoneyMovementId===null);
   supplier={...payable,template,purpose,supplierSettlementId,supplierMoneyMovementId};
  }else{
   check(purpose==='supplier_settlement_money'&&code!=='2200'&&debitCents==='0'&&customerUuid(supplierMoneyMovementId));
   supplier={...payable,template,purpose,supplierSettlementId,supplierMoneyMovementId};
  }
 }
 // Preserve the original positions and amounts so the earlier parser also
 // validates ordering, running balances, and the absence of foreign links.
 return {supplier,row:{...row,template:'P03',paymentId:row.eventId,purpose:creditCents==='0'?'receipt_money':'receipt_ar'}};
}

export function parseFictionalJournalV16(input:unknown,businessId:string,throughOn:string,accountId:string|null,afterLineId:string|null,
 pageSize=fictionalJournalV15PageSize){
 const report=projectSupplierReport(input,16,15);
 check('rows' in report&&Array.isArray(report.rows)&&report.rows.length<=pageSize);
 const candidates=report.rows.map(projectJournalRow);
 const prior=parseFictionalJournalV15({...report,rows:candidates.map(item=>item.row)},businessId,throughOn,accountId,afterLineId,pageSize);
 const rows=prior.rows.map((row,index)=>{
  const supplier=candidates[index]!.supplier;
  if(supplier===null)return {...row,supplierPayableId:null,supplierBillId:null,supplierSettlementId:null,supplierMoneyMovementId:null};
  check(row.template==='P03'&&row.paymentId===row.eventId);
  return {...row,...supplier,paymentId:null};
 });
 type Row=Extract<(typeof rows)[number],{supplierPayableId:string}>;
 const events=new Map<string,Row[]>(),sourceEvents=new Map<string,string>(),billIds=new Map<string,string>();
 for(const row of rows){
  if(row.supplierPayableId===null)continue;
  const sourceId=row.template+':'+(row.supplierSettlementId??row.supplierPayableId);
  const sourceEvent=sourceEvents.get(sourceId)??row.eventId;
  const billId=billIds.get(row.supplierPayableId)??row.supplierBillId;
  check(sourceEvent===row.eventId&&billId===row.supplierBillId);
  sourceEvents.set(sourceId,row.eventId);
  billIds.set(row.supplierPayableId,row.supplierBillId);
  const peers=events.get(row.eventId)??[];
  const first=peers[0];
  if(first)check(first.template===row.template&&first.entryId===row.entryId&&first.operationId===row.operationId
   &&first.supplierPayableId===row.supplierPayableId&&first.supplierSettlementId===row.supplierSettlementId
   &&first.effectiveOn===row.effectiveOn&&first.commitSequence===row.commitSequence
   &&first.eventSequence===row.eventSequence&&first.entrySequence===row.entrySequence
   &&(row.purpose==='supplier_bill_cost'||!peers.some(peer=>peer.purpose===row.purpose)));
  peers.push(row);
  events.set(row.eventId,peers);
 }
 check(rows.every(row=>row.supplierPayableId!==null||!events.has(row.eventId)));
 if(accountId===null&&afterLineId===null&&!prior.hasMore)for(const peers of events.values()){
  const accrual=peers[0]!.template==='P14';
  check(peers.length>=2&&(!accrual||peers.some(row=>row.purpose==='supplier_bill_payable'))
   &&peers.reduce((total,row)=>total+BigInt(row.debitCents)-BigInt(row.creditCents),0n)===0n);
 }
 return {...prior,schemaVersion:16 as const,rows,coverage:{...prior.coverage,templates},controls:{...prior.controls,...supplierControl}};
}
