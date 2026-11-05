import {customerUuid} from '../customer/customer-contract';
import {quoteDollarsInput} from '../commercial/quote-pricing';
import {validateScopeAllocationPlan} from '../operations/scope-allocation-plan';
import type {AllocationPart} from '../operations/scope-allocation-plan';
import type {BookingPlan} from '../operations/confirmed-booking-contract';
import type {CurrentBookingSource} from '../operations/booking-context-contract';

export type BookingDivision=Readonly<{amount:string;discount:string;visitScope:string;remainingScope:string;remainderId:string}>;
export const divisionKey=(sourceId:string,partitionId:string)=>sourceId+'/'+partitionId;
export function hasBookingDivision(value:BookingDivision|undefined){return !!value&&[value.amount,value.discount,value.visitScope,value.remainingScope].some(text=>text.trim()!=='');}
function fail():never{throw Error('BOOKING_SCOPE_DIVISION_REVIEW_REQUIRED');}
export function divideBookingPart(source:CurrentBookingSource,part:AllocationPart,jobId:string,draft:BookingDivision):readonly AllocationPart[]{
 if(!customerUuid(jobId)||!customerUuid(draft.remainderId)||part.state!=='unassigned'||part.jobId!==null||!source.parts.some(row=>row===part)||source.parts.some(row=>row.partitionId===draft.remainderId)||part.amountCents==='0')fail();
 const amount=BigInt(quoteDollarsInput(draft.amount)),discount=part.discountInclusiveCents==='0'?draft.discount.trim()===''?0n:BigInt(quoteDollarsInput(draft.discount)):BigInt(quoteDollarsInput(draft.discount));
 if(amount>BigInt(part.amountCents)||discount>BigInt(part.discountInclusiveCents))fail();
 const gross=amount+discount;
 const parts:AllocationPart[]=[{...part,jobId,state:'assigned',amountCents:amount.toString(),discountInclusiveCents:discount.toString(),grossInclusiveCents:gross.toString(),scopeDescription:draft.visitScope},{...part,partitionId:draft.remainderId,jobId:null,state:'unassigned',amountCents:(BigInt(part.amountCents)-amount).toString(),discountInclusiveCents:(BigInt(part.discountInclusiveCents)-discount).toString(),grossInclusiveCents:(BigInt(part.grossInclusiveCents)-gross).toString(),scopeDescription:draft.remainingScope}];
 return validateScopeAllocationPlan({id:source.sourceAllocationId,grossInclusiveCents:part.grossInclusiveCents,discountInclusiveCents:part.discountInclusiveCents,amountCents:part.amountCents},parts).parts;
}
// All amounts are owner-entered allocations of existing terms. No percentage
// allocation, price/tax rule, posting, cancellation or mutation is inferred.
export function prepareBookingDivisions(sources:readonly CurrentBookingSource[],plans:readonly BookingPlan[],jobId:string,drafts:Readonly<Record<string,BookingDivision>>):readonly BookingPlan[]{
 const used=new Set<string>(),partitionIds=new Set(sources.flatMap(source=>source.parts.map(part=>part.partitionId)));
 const result=plans.map(plan=>{
  const source=sources.find(row=>row.sourceAllocationId===plan.sourceAllocationId&&row.planSequence===plan.expectedSequence);if(!source)fail();
  const parts=plan.parts.flatMap(part=>{
   const key=divisionKey(source.sourceAllocationId,part.partitionId),draft=drafts[key];if(!hasBookingDivision(draft))return [part];
   const original=source.parts.find(row=>row.partitionId===part.partitionId);if(!original||part.state!=='assigned'||part.jobId!==jobId||partitionIds.has(draft!.remainderId))fail();
   used.add(key);partitionIds.add(draft!.remainderId);return [...divideBookingPart(source,original,jobId,draft!)];
  });
  validateScopeAllocationPlan({id:source.sourceAllocationId,grossInclusiveCents:source.grossInclusiveCents,discountInclusiveCents:source.discountInclusiveCents,amountCents:source.amountCents},parts);
  return Object.freeze({...plan,parts:Object.freeze(parts)});
 });
 if(Object.entries(drafts).some(([key,value])=>hasBookingDivision(value)&&!used.has(key)))fail();
 return Object.freeze(result);
}
