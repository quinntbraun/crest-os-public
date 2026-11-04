// BR05/BR06 request structure and exact arithmetic only. The transaction must
// load every actual entitlement/allocation, compare versions under family and
// finance locks, verify jobs/retained work/consumption and audit the whole result.
// A parsed plan grants no acceptance, job cancellation or financial authority.
import {quoteId,quoteVersion,quoteBodyLimit} from './quote-storage-contract.ts';
import {QuoteAmendmentContractError} from './quote-amendment-contract.ts';
import {validateScopeAllocationPlan} from '../operations/scope-allocation-plan.ts';
import type {AllocationPart} from '../operations/scope-allocation-plan.ts';

export type QuoteAmendmentScopePlan=Readonly<{
 stableLineKey:string;entitlementId:string;expectedEntitlementVersionId:string|null;
 entitlementVersionId:string;sourceAllocationId:string;sourcePartitionId:string;
 expectedPlanId:string|null;expectedPlanSequence:string;
 authorizationState:'active'|'withdrawn';grossInclusiveCents:string;
 discountInclusiveCents:string;amountCents:string;parts:readonly AllocationPart[];
}>;
const keys=['stableLineKey','entitlementId','expectedEntitlementVersionId','entitlementVersionId','sourceAllocationId','sourcePartitionId','expectedPlanId','expectedPlanSequence','authorizationState','grossInclusiveCents','discountInclusiveCents','amountCents','parts'] as const;
const partKeys=['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'] as const;
const moneyKeys=['grossInclusiveCents','discountInclusiveCents','amountCents'] as const;
function check(value:unknown):asserts value{if(!value)throw new QuoteAmendmentContractError();}
function record(value:unknown,fields:readonly string[]):Record<string,unknown>{
 check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
 const descriptors=Object.getOwnPropertyDescriptors(value);
 check(Reflect.ownKeys(descriptors).length===fields.length&&fields.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')));
 return Object.fromEntries(fields.map(key=>[key,descriptors[key]!.value]));
}
function array(value:unknown,limit:number):unknown[]{
 check(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=limit);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 check(Reflect.ownKeys(descriptors).length===value.length+1);
 return Array.from({length:value.length},(_,index)=>{const d=descriptors[String(index)];check(d&&d.enumerable&&Object.hasOwn(d,'value'));return d.value;});
}
export function parseQuoteAmendmentScopePlans(value:unknown):readonly QuoteAmendmentScopePlan[]{
 try{
  let count=0,total=0n;const oldVersions=new Set<string>(),oldPlans=new Set<string>(),seen=Object.fromEntries(['stableLineKey','entitlementId','entitlementVersionId','sourceAllocationId','sourcePartitionId'].map(key=>[key,new Set<string>()]));
  const plans=array(value,1000).map(raw=>{
   const row=record(raw,keys);
   for(const key of Object.keys(seen)){check(quoteId(row[key])&&!seen[key]!.has(row[key]));seen[key]!.add(row[key]);}
   check(row.expectedEntitlementVersionId===null||quoteId(row.expectedEntitlementVersionId)&&row.expectedEntitlementVersionId!==row.entitlementVersionId);
   if(row.expectedEntitlementVersionId!==null){check(!oldVersions.has(row.expectedEntitlementVersionId));oldVersions.add(row.expectedEntitlementVersionId);}
   check(quoteVersion(row.expectedPlanSequence,true)&&BigInt(row.expectedPlanSequence)<9223372036854775807n&&(row.expectedPlanSequence==='0'?row.expectedPlanId===null:quoteId(row.expectedPlanId)));
   if(row.expectedPlanId!==null){check(!oldPlans.has(row.expectedPlanId as string));oldPlans.add(row.expectedPlanId as string);}
   // New identities cannot assert that an earlier allocation plan exists.
   check(row.expectedEntitlementVersionId!==null||row.expectedPlanSequence==='0');
   for(const key of moneyKeys)check(quoteVersion(row[key],true));
   check(BigInt(row.grossInclusiveCents as string)-BigInt(row.discountInclusiveCents as string)===BigInt(row.amountCents as string));
   total+=BigInt(row.amountCents as string);check(total<=9223372036854775807n);
   const parts=array(row.parts,10000).map(part=>record(part,partKeys));count+=parts.length;check(count<=10000);
   if(row.authorizationState==='withdrawn'){
    // Absence of remaining scope is explicit. Never synthesize a zero-price
    // line/partition to stand in for removed authorization. Prior events remain
    // immutable; the command must reject unresolved completed/billed/job scope.
    check(row.expectedEntitlementVersionId!==null&&moneyKeys.every(key=>row[key]==='0')&&parts.length===0);
    const noRemainingParts:readonly AllocationPart[]=Object.freeze([]);
    return Object.freeze({...row,parts:noRemainingParts}) as QuoteAmendmentScopePlan;
   }
   check(row.authorizationState==='active');
   const normalized=validateScopeAllocationPlan({id:row.sourceAllocationId,...Object.fromEntries(moneyKeys.map(key=>[key,row[key]]))},parts);
   if(row.amountCents==='0')check(normalized.parts.length===1&&normalized.parts[0]!.partitionId===row.sourcePartitionId);
   return Object.freeze({...row,parts:normalized.parts}) as QuoteAmendmentScopePlan;
  });
  check(plans.every(plan=>!oldVersions.has(plan.entitlementVersionId))&&new TextEncoder().encode(JSON.stringify(plans)).length<=quoteBodyLimit);
  return Object.freeze(plans);
 }catch{throw new QuoteAmendmentContractError();}
}
