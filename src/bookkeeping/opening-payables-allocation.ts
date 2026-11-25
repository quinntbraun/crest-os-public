// Preparation over explicit original payment/credit evidence, never authority
// to post or proof that an external document/payment has been authenticated.
import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {normalizeOpeningPayablesEvidence} from './opening-payables-contract.ts';
import type {OpeningPayablesInput} from './opening-payables-contract.ts';

type Document=Readonly<{reference:string;sha256:string}>;
type Root=Readonly<{rootId:string;sourceNamespace:string;externalId:string;vendor:string;
 kind:'payment'|'supplier_credit';reference:string;appliedOn:string;originalCents:string;evidence:Document;
 otherAllocatedCents:string;otherAllocationEvidence:Document|null}>;
export type OpeningPayablesAllocationInput=Readonly<{schemaVersion:1;roots:readonly Root[];reason:string}>;
const maximum=9223372036854775807n;
export class OpeningPayablesAllocationError extends Error{constructor(){super('OPENING_PAYABLES_ALLOCATION_REVIEW_REQUIRED');this.name='OpeningPayablesAllocationError';}}
function require(value:unknown):asserts value{if(!value)throw new OpeningPayablesAllocationError();}
function label(value:unknown):value is string{return financeAccountReviewReason(value)&&[...value].length<=200;}
function document(value:unknown):asserts value is Document{require(exact(value,['reference','sha256'])&&label(value.reference)&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256));}
function cents(value:unknown,positive=false){require(typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value));const amount=BigInt(value);require(amount<=maximum&&(!positive||amount>0n));return amount;}
function freeze<T>(value:T):Readonly<T>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const key=(vendor:string,kind:string,reference:string)=>JSON.stringify([vendor,kind,reference]);

export function prepareOpeningPayablesAllocations(scheduleInput:OpeningPayablesInput,cutoverOn:string,input:unknown){
 try{
  const schedule=normalizeOpeningPayablesEvidence(scheduleInput,cutoverOn);
  require(exact(input,['schemaVersion','roots','reason'])&&input.schemaVersion===1&&financeAccountReviewReason(input.reason)&&Array.isArray(input.roots)&&input.roots.length<=1000&&new TextEncoder().encode(JSON.stringify(input)).byteLength<=1048576);
  const roots=new Map<string,{root:Root;original:bigint;elsewhere:bigint;allocated:bigint;allocations:{billId:string;amountCents:string}[]}>(),ids=new Set<string>(),origins=new Set<string>();
  for(const root of input.roots as readonly Root[]){
   require(exact(root,['rootId','sourceNamespace','externalId','vendor','kind','reference','appliedOn','originalCents','evidence','otherAllocatedCents','otherAllocationEvidence'])&&customerUuid(root.rootId)&&!ids.has(root.rootId)&&typeof root.sourceNamespace==='string'&&/^[a-z][a-z0-9_.-]{0,99}$/.test(root.sourceNamespace)&&label(root.externalId)&&label(root.vendor)&&(root.kind==='payment'||root.kind==='supplier_credit')&&label(root.reference)&&customerDate(root.appliedOn)&&root.appliedOn<cutoverOn);
   const identity=JSON.stringify([root.sourceNamespace,root.externalId]),binding=key(root.vendor,root.kind,root.reference);require(!origins.has(identity)&&!roots.has(binding));ids.add(root.rootId);origins.add(identity);document(root.evidence);
   const original=cents(root.originalCents,true),elsewhere=cents(root.otherAllocatedCents);require(elsewhere<=original);
   if(elsewhere>0n)document(root.otherAllocationEvidence);else require(root.otherAllocationEvidence===null);
   roots.set(binding,{root:structuredClone(root),original,elsewhere,allocated:0n,allocations:[]});
  }
  let reductionCount=0;
  for(const bill of schedule.bills)for(const reduction of bill.reductions){
   const source=roots.get(key(bill.vendor,reduction.kind,reduction.reference));require(source);
   require(source.root.appliedOn===reduction.appliedOn&&source.root.evidence.reference===reduction.evidence.reference&&source.root.evidence.sha256===reduction.evidence.sha256);
   source.allocated+=BigInt(reduction.amountCents);require(source.allocated+source.elsewhere<=source.original);
   source.allocations.push({billId:bill.billId,amountCents:reduction.amountCents});reductionCount++;
  }
  const result=[];
  for(const {root,original,elsewhere,allocated,allocations} of roots.values()){
   require(allocations.length>0); // Unrelated roots must not disguise missing bill evidence.
   result.push({...root,allocations,selectedAllocationCents:allocated.toString(),unallocatedCents:(original-elsewhere-allocated).toString()});
  }
  return freeze({schemaVersion:1 as const,cutoverOn,currency:'USD' as const,reason:input.reason,
   roots:result,rootCount:result.length,reductionCount,remainingPayablesCents:schedule.totals.remainingCents,
   selectedAllocationCapacityChecked:true as const,externalEvidenceVerified:false as const,
   historicalAllocationClosureVerified:false as const,fullSourceClosureVerified:false as const,
   posted:false as const,paymentAuthorized:false as const,newExpenseCents:'0' as const,newPaymentCents:'0' as const});
 }catch{throw new OpeningPayablesAllocationError();}
}
