// Pre-cutover supplier obligations only. A prepared schedule creates no expense,
// supplier payment, tax recovery, approval or live payable.
import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {historyJsonEqual,parseHistoryJson} from '../security/history-evidence-json.ts';
type Document=Readonly<{reference:string;sha256:string}>;
type Reduction=Readonly<{kind:'payment'|'supplier_credit';reference:string;appliedOn:string;amountCents:string;evidence:Document}>;
type Bill=Readonly<{billId:string;sourceNamespace:string;externalId:string;vendor:string;purpose:string;incurredOn:string;originalDueOn:string|null;unknownDueReason:string|null;originalCents:string;remainingCents:string;billEvidence:Document;reductions:readonly Reduction[];taxEvidence:Document|null}>;
export type OpeningPayablesInput=Readonly<{schemaVersion:1;bills:readonly Bill[];reason:string}>;
const maximum=9223372036854775807n;
export class OpeningPayablesEvidenceError extends Error{constructor(){super('OPENING_PAYABLES_EVIDENCE_REQUIRED');this.name='OpeningPayablesEvidenceError';}}
function require(value:unknown):asserts value{if(!value)throw new OpeningPayablesEvidenceError();}
function label(value:unknown):value is string{return financeAccountReviewReason(value)&&[...value].length<=200;}
function document(value:unknown):asserts value is Document{require(exact(value,['reference','sha256'])&&label(value.reference)&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256));}
function cents(value:unknown){require(typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value));const amount=BigInt(value);require(amount<=maximum);return amount;}
function freeze<T>(value:T):Readonly<T>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export function normalizeOpeningPayablesEvidence(input:unknown,cutoverOn:string){
 try{
  require(exact(input,['schemaVersion','bills','reason'])&&input.schemaVersion===1&&customerDate(cutoverOn)&&financeAccountReviewReason(input.reason)&&Array.isArray(input.bills)&&input.bills.length<=200&&new TextEncoder().encode(JSON.stringify(input)).byteLength<=1048576);
  const ids=new Set<string>(),origins=new Set<string>();let total=0n,unknownDueCount=0,unknownTaxCount=0;
  const bills=[];
  for(const bill of input.bills as readonly Bill[]){
   require(exact(bill,['billId','sourceNamespace','externalId','vendor','purpose','incurredOn','originalDueOn','unknownDueReason','originalCents','remainingCents','billEvidence','reductions','taxEvidence'])&&customerUuid(bill.billId)&&!ids.has(bill.billId)&&typeof bill.sourceNamespace==='string'&&/^[a-z][a-z0-9_.-]{0,99}$/.test(bill.sourceNamespace)&&label(bill.externalId)&&label(bill.vendor)&&financeAccountReviewReason(bill.purpose)&&customerDate(bill.incurredOn)&&bill.incurredOn<cutoverOn&&Array.isArray(bill.reductions)&&bill.reductions.length<=100);
   ids.add(bill.billId);const origin=JSON.stringify([bill.sourceNamespace,bill.externalId]);require(!origins.has(origin));origins.add(origin);document(bill.billEvidence);
   if(bill.originalDueOn===null){require(financeAccountReviewReason(bill.unknownDueReason));unknownDueCount++;}
   else require(customerDate(bill.originalDueOn)&&bill.originalDueOn>=bill.incurredOn&&bill.unknownDueReason===null);
   if(bill.taxEvidence===null)unknownTaxCount++;else document(bill.taxEvidence);
   const original=cents(bill.originalCents),remaining=cents(bill.remainingCents),references=new Set<string>();let reduced=0n;
   for(const reduction of bill.reductions){
    require(exact(reduction,['kind','reference','appliedOn','amountCents','evidence'])&&(reduction.kind==='payment'||reduction.kind==='supplier_credit')&&label(reduction.reference)&&!references.has(reduction.reference)&&customerDate(reduction.appliedOn)&&reduction.appliedOn>=bill.incurredOn&&reduction.appliedOn<cutoverOn);references.add(reduction.reference);document(reduction.evidence);reduced+=cents(reduction.amountCents);require(reduced<=original);
   }
   require(original-reduced===remaining);total+=remaining;require(total<=maximum);
   bills.push({...structuredClone(bill),openingLiabilityCents:remaining.toString(),dueState:bill.originalDueOn===null?'unknown' as const:'source_recorded' as const,taxState:bill.taxEvidence===null?'unknown' as const:'source_recorded' as const});
  }
  return freeze({schemaVersion:1 as const,cutoverOn,currency:'USD' as const,state:'evidence_prepared' as const,reason:input.reason,bills,totals:{remainingCents:total.toString(),billCount:bills.length,unknownDueCount,unknownTaxCount},posted:false as const,paymentAuthorized:false as const,newExpenseCents:'0' as const,newPaymentCents:'0' as const,verifiedZero:false as const,historicalAllocationClosureVerified:false as const,fullSourceClosureVerified:false as const});
 }catch{throw new OpeningPayablesEvidenceError();}
}
export function verifyOpeningPayablesEvidence(value:unknown,input:OpeningPayablesInput,cutoverOn:string){
 const expected=normalizeOpeningPayablesEvidence(input,cutoverOn);
 try{require(historyJsonEqual(parseHistoryJson(JSON.stringify(value)),parseHistoryJson(JSON.stringify(expected))));return expected;}catch{throw new OpeningPayablesEvidenceError();}
}
