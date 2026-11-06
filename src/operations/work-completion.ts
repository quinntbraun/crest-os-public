// BR06/BR07 and ACCOUNTING5: explicit operational fulfillment of accepted
// allocations. This is not authorization, customer agreement, invoice review,
// consumption transfer or posting. The transaction must load/lock real sources.
import {customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {validateScopeAllocationPlan} from './scope-allocation-plan.ts';
import type {AllocationPart} from './scope-allocation-plan.ts';

export type CompletionAssignedPart=AllocationPart&Readonly<{id:string}>;
export type CompletionPlan=Readonly<{sourceAllocationId:string;planId:string;planSequence:string;grossInclusiveCents:string;discountInclusiveCents:string;amountCents:string;parts:readonly CompletionAssignedPart[]}>;
export type WorkOutcome='completed'|'unfulfilled'|'cancelled';
export type CompletionPiece=Readonly<{partitionId:string;outcome:WorkOutcome;scopeDescription:string;grossInclusiveCents:string;discountInclusiveCents:string;amountCents:string;reason:string|null}>;
export type CompletionAllocation=Readonly<{assignedPartId:string;expectedPlanId:string;expectedPlanSequence:string;pieces:readonly CompletionPiece[]}>;
export class WorkCompletionError extends Error{constructor(){super('WORK_COMPLETION_REVIEW_REQUIRED');this.name='WorkCompletionError';}}
function check(value:unknown):asserts value{if(!value)throw new WorkCompletionError();}
function text(value:unknown,max:number):value is string{return typeof value==='string'&&value.trim().length>0&&[...value].length<=max&&[...value].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||[9,10,13].includes(n));});}
const partKeys=['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'] as const;
function validated(source:unknown,parts:unknown){try{return validateScopeAllocationPlan(source,parts);}catch{throw new WorkCompletionError();}}

export function planCompletedScope(jobId:string,plans:unknown,input:unknown){
 check(customerUuid(jobId)&&Array.isArray(plans)&&plans.length>0&&Array.isArray(input)&&input.length>0);
 check(new TextEncoder().encode(JSON.stringify({plans,input})).byteLength<=1048576);
 const submitted=new Map<string,CompletionAllocation>(),used=new Set<string>(),allPartIds=new Set<string>(),allPartitionIds=new Set<string>(),sourceIds=new Set<string>();
 for(const value of input){
  check(exact(value,['assignedPartId','expectedPlanId','expectedPlanSequence','pieces'])&&customerUuid(value.assignedPartId)&&customerUuid(value.expectedPlanId)&&customerVersion(value.expectedPlanSequence)&&Array.isArray(value.pieces)&&value.pieces.length>0&&!submitted.has(value.assignedPartId));
  const pieces=value.pieces.map(v=>{check(exact(v,['partitionId','outcome','scopeDescription','grossInclusiveCents','discountInclusiveCents','amountCents','reason'])&&customerUuid(v.partitionId)&&['completed','unfulfilled','cancelled'].includes(v.outcome as string)&&text(v.scopeDescription,2000)&&(v.reason===null||text(v.reason,1000))&&(v.outcome==='completed'||v.reason!==null));return Object.freeze({...v}) as CompletionPiece;});
  submitted.set(value.assignedPartId,Object.freeze({...value,pieces:Object.freeze(pieces)}) as CompletionAllocation);
 }
 const sealedPlans=plans.map(v=>{
  check(exact(v,['sourceAllocationId','planId','planSequence','grossInclusiveCents','discountInclusiveCents','amountCents','parts'])&&customerUuid(v.sourceAllocationId)&&customerUuid(v.planId)&&customerVersion(v.planSequence)&&BigInt(v.planSequence)<9223372036854775807n&&Array.isArray(v.parts)&&v.parts.length>0&&!sourceIds.has(v.sourceAllocationId));sourceIds.add(v.sourceAllocationId);
  const parts=v.parts.map(p=>{check(exact(p,[...partKeys,'id'])&&customerUuid(p.id)&&!allPartIds.has(p.id)&&customerUuid(p.partitionId)&&!allPartitionIds.has(p.partitionId));allPartIds.add(p.id);allPartitionIds.add(p.partitionId);return Object.freeze({...p}) as CompletionAssignedPart;});
  validated({id:v.sourceAllocationId,grossInclusiveCents:v.grossInclusiveCents,discountInclusiveCents:v.discountInclusiveCents,amountCents:v.amountCents},parts.map(p=>Object.fromEntries(partKeys.map(k=>[k,p[k]]))));
  return Object.freeze({...v,parts:Object.freeze(parts)}) as CompletionPlan;
 });
 const outcomes:Readonly<{assignedPartId:string;partitionId:string;outcome:WorkOutcome;scopeDescription:string;completedCents:string;reason:string|null}>[]=[];
 let fulfilled=0,unfulfilled=0,completed=0n;
 const result=sealedPlans.map(plan=>{
  let changed=false;
  const parts=plan.parts.flatMap(original=>{
   if(original.jobId!==jobId||original.state!=='assigned')return [Object.freeze(Object.fromEntries(partKeys.map(k=>[k,original[k]]))) as AllocationPart];
   const allocation=submitted.get(original.id);check(allocation&&allocation.expectedPlanId===plan.planId&&allocation.expectedPlanSequence===plan.planSequence&&!used.has(original.id));used.add(original.id);changed=true;
   check(allocation.pieces.some(p=>p.partitionId===original.partitionId));
   for(const piece of allocation.pieces){check(piece.partitionId===original.partitionId||!allPartitionIds.has(piece.partitionId));if(piece.partitionId!==original.partitionId)allPartitionIds.add(piece.partitionId);}
   const next=validated({id:original.partitionId,grossInclusiveCents:original.grossInclusiveCents,discountInclusiveCents:original.discountInclusiveCents,amountCents:original.amountCents},allocation.pieces.map(p=>({partitionId:p.partitionId,jobId,state:p.outcome==='completed'?'completed':'cancelled',grossInclusiveCents:p.grossInclusiveCents,discountInclusiveCents:p.discountInclusiveCents,amountCents:p.amountCents,scopeDescription:p.scopeDescription}))).parts;
   for(const p of allocation.pieces){if(p.outcome==='completed'){fulfilled++;completed+=BigInt(p.amountCents);}else unfulfilled++;outcomes.push(Object.freeze({assignedPartId:original.id,partitionId:p.partitionId,outcome:p.outcome,scopeDescription:p.scopeDescription,completedCents:p.outcome==='completed'?p.amountCents:'0',reason:p.reason}));}
   return [...next];
  });
  check(changed);validated({id:plan.sourceAllocationId,grossInclusiveCents:plan.grossInclusiveCents,discountInclusiveCents:plan.discountInclusiveCents,amountCents:plan.amountCents},parts);
  return Object.freeze({sourceAllocationId:plan.sourceAllocationId,expectedPlanId:plan.planId,expectedPlanSequence:plan.planSequence,parts:Object.freeze(parts)});
 });
 check(used.size===submitted.size&&fulfilled>0);
 return Object.freeze({completionOutcome:unfulfilled>0?'partial' as const:'full' as const,needsCommercialResolution:unfulfilled>0,completedCents:completed.toString(),fulfilledPortions:fulfilled,unfulfilledPortions:unfulfilled,plans:Object.freeze(result),outcomes:Object.freeze(outcomes)});
}
