// BR06/ACCOUNTING5 arithmetic only. The trusted transaction must independently
// load accepted sources, lock families, validate job/vehicle bindings and retain
// prior allocations/consumption. This pure boundary grants no write authority.
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
export type AllocationSource=Readonly<{id:string;grossInclusiveCents:string;discountInclusiveCents:string;amountCents:string}>;
export type AllocationPart=Readonly<{partitionId:string;jobId:string|null;state:'unassigned'|'assigned'|'completed'|'cancelled';grossInclusiveCents:string;discountInclusiveCents:string;amountCents:string;scopeDescription:string}>;
export class ScopeAllocationError extends Error{constructor(){super('SCOPE_ALLOCATION_REVIEW_REQUIRED');this.name='ScopeAllocationError';}}
function requireAllocation(value:unknown):asserts value{if(!value)throw new ScopeAllocationError();}
function cents(value:unknown):value is string{return typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;}
function money(value:{grossInclusiveCents:unknown;discountInclusiveCents:unknown;amountCents:unknown}){
 requireAllocation(cents(value.grossInclusiveCents)&&cents(value.discountInclusiveCents)&&cents(value.amountCents));
 requireAllocation(BigInt(value.grossInclusiveCents)-BigInt(value.discountInclusiveCents)===BigInt(value.amountCents));
}
function description(value:unknown):value is string{return typeof value==='string'&&[...value].length<=2000&&value.trim().length>0&&[...value].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||[9,10,13].includes(n));});}
export function validateScopeAllocationPlan(source:unknown,input:unknown):Readonly<{source:AllocationSource;parts:readonly AllocationPart[]}>{
 requireAllocation(exact(source,['id','grossInclusiveCents','discountInclusiveCents','amountCents'])&&customerUuid(source.id));money(source as Record<'grossInclusiveCents'|'discountInclusiveCents'|'amountCents',unknown>);
 requireAllocation(Array.isArray(input)&&input.length>0);const ids=new Set<string>();
 let gross=0n,discount=0n,amount=0n;
 const parts=input.map(value=>{
  requireAllocation(exact(value,['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'])&&customerUuid(value.partitionId)&&(value.jobId===null||customerUuid(value.jobId))&&['unassigned','assigned','completed','cancelled'].includes(value.state as string)&&(value.jobId===null)===(value.state==='unassigned')&&description(value.scopeDescription));money(value as Record<'grossInclusiveCents'|'discountInclusiveCents'|'amountCents',unknown>);
  requireAllocation(!ids.has(value.partitionId));ids.add(value.partitionId);
  gross+=BigInt(value.grossInclusiveCents as string);discount+=BigInt(value.discountInclusiveCents as string);amount+=BigInt(value.amountCents as string);
  return Object.freeze({...value}) as AllocationPart;
 });
 requireAllocation(gross===BigInt(source.grossInclusiveCents as string)&&discount===BigInt(source.discountInclusiveCents as string)&&amount===BigInt(source.amountCents as string));
 return Object.freeze({source:Object.freeze({...source}) as AllocationSource,parts:Object.freeze(parts)});
}
