// Independent included-source checks for the three field commands which append
// commercial allocation plans. No database lookup, repair or financial posting.
import {isDeepStrictEqual as same} from 'node:util';
import {requireQuoteStorage as check} from '../commercial/quote-storage-contract.ts';
import type {FieldSourceInput} from './field-source.ts';
import {fieldSourceGroups,fieldSourceSchema} from './field-source-schema.ts';
import type {BookingSourceInput} from './confirmed-booking-source-csv.ts';

type Row = Readonly<Record<string, unknown>>;
type Input = Readonly<{
 businessId: string;
 field: FieldSourceInput;
 plan: Row;
 previous: Row;
 operation: Row;
 parts: readonly Row[];
 previousParts: readonly Row[];
 events: readonly Row[];
}>;

const content = (p: Row) => ({
 partitionId: p.stable_partition_id, jobId: p.job_id, state: p.allocation_state,
 gross: p.gross_inclusive_cents, discount: p.discount_inclusive_cents,
 amount: p.amount_cents, description: p.scope_description,
});
function object(v: unknown): asserts v is Record<string, unknown> {
 check(!!v && typeof v === 'object' && !Array.isArray(v));
}
function array(v: unknown): asserts v is Record<string, unknown>[] {
 check(Array.isArray(v));for (const row of v) object(row);
}

export function verifyFieldBookingParents(field: FieldSourceInput,bookings: BookingSourceInput) {
 check(field.context.businessId===bookings.businessId && field.context.historySnapshotToken===bookings.historySnapshotToken);
 const parents: Readonly<Record<string,readonly Row[]>>={
  'crest.jobs':bookings.rows.jobs,'crest.job_encounters':bookings.rows.job_encounters,
  'crest.allocation_plan_parts':bookings.rows.allocation_plan_parts,
 };
 for(const group of fieldSourceGroups)for(const fk of fieldSourceSchema[group].foreignKeys) {
  const target=parents[fk.target];if(!target)continue;
  const identities=new Set(target.map(row=>JSON.stringify(fk.targetColumns.map(k=>row[k]))));
  for(const row of field.rows[group]) {
   const key=fk.columns.map(k=>row[k]);if(key.some(v=>v===null))continue;
   check(identities.has(JSON.stringify(key)));
  }
 }
 for(const row of field.rows.work_intervals) {
  const job=bookings.rows.jobs.find(j=>j.id===row.job_id);
  check(job && job.operator_actor_id===row.operator_actor_id && job.first_work_at!==null);
 }
 for(const row of field.rows.travel_legs)if(row.job_context_id!==null) {
  const job=bookings.rows.jobs.find(j=>j.id===row.job_context_id);
  check(job && job.operator_actor_id===row.operator_actor_id);
 }
}

export function verifyFieldAllocationPlan(input: Input) {
 const {businessId,field,plan,previous,operation,parts,previousParts,events}=input;
 const kind=operation.command_type;
 check(['operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled'].includes(String(kind)));
 check(operation.schema_version===1 && operation.result_schema_version===1 && operation.state==='committed');
 check(plan.replaces_id===previous.id && plan.source_allocation_id===previous.source_allocation_id
  && plan.entitlement_version_id===previous.entitlement_version_id && plan.authorization_state===previous.authorization_state);
 const matching=events.filter(e=>e.operation_id===plan.operation_id);
 check(matching.length===1);const event=matching[0]!;
 check(typeof event.evidence==='string' && typeof operation.result==='string');
 const evidence: unknown=JSON.parse(event.evidence),receipt: unknown=JSON.parse(operation.result);
 object(evidence);object(receipt);const request=evidence.request;object(request);const body=request.body;object(body);
 const expectedVersion=kind==='operations.job.complete'?request.expectedVersion:request.expectedJobVersion;
 check(request.schemaVersion===1 && request.commandType===kind && request.businessId===businessId
  && request.actorId===operation.actor_id && request.recoveryEpoch===operation.recovery_epoch && request.jobId===event.job_id
  && typeof expectedVersion==='string' && BigInt(expectedVersion)+1n===BigInt(String(event.sequence)));
 check(receipt.schemaVersion===1 && receipt.commandType===kind && receipt.businessId===businessId
  && receipt.actorId===operation.actor_id && receipt.operationId===operation.operation_id
  && receipt.recoveryEpoch===operation.recovery_epoch && receipt.jobId===event.job_id && receipt.jobVersion===event.sequence);
 check(event.created_by===operation.actor_id && plan.created_by===operation.actor_id
  && parts.every(p=>p.operation_id===plan.operation_id && p.created_by===operation.actor_id));
 const consumed=new Set<unknown>();
 const take=(partitionId: unknown)=>{
  const found=parts.filter(p=>p.stable_partition_id===partitionId);check(found.length===1 && !consumed.has(partitionId));
  consumed.add(partitionId);return found[0]!;
 };
 array(body.scope);
 if(kind==='operations.job.complete') {
  check(event.to_state==='completed' && ['in_progress','paused'].includes(String(event.from_state)));
  check(Array.isArray(receipt.allocationPlanIds) && receipt.allocationPlanIds.includes(plan.id));
  let fulfilled=false;
  for(const prior of previousParts) {
   if(prior.job_id!==event.job_id) {check(same(content(prior),content(take(prior.stable_partition_id))));continue;}
   check(prior.allocation_state==='assigned');
   const entries=body.scope.filter(s=>s.assignedPartId===prior.id);check(entries.length===1);
   const entry=entries[0]!;check(entry.expectedPlanId===previous.id && entry.expectedPlanSequence===previous.sequence);
   array(entry.pieces);check(entry.pieces.length>0);
   let gross=0n,discount=0n,amount=0n;
   for(const piece of entry.pieces) {
    check(['completed','unfulfilled','cancelled'].includes(String(piece.outcome)));
    const p=take(piece.partitionId);
    check(same(content(p),{partitionId:piece.partitionId,jobId:event.job_id,
     state:piece.outcome==='completed'?'completed':'cancelled',gross:piece.grossInclusiveCents,
     discount:piece.discountInclusiveCents,amount:piece.amountCents,description:piece.scopeDescription}));
    const outcomes=field.rows.work_scope_outcomes.filter(o=>o.completion_part_id===p.id);
    check(outcomes.length===1);const outcome=outcomes[0]!;
    check(outcome.operation_id===plan.operation_id && outcome.job_id===event.job_id && outcome.assigned_part_id===prior.id
     && outcome.partition_id===p.stable_partition_id && outcome.outcome===piece.outcome && outcome.scope_description===p.scope_description
     && outcome.completed_cents===(piece.outcome==='completed'?p.amount_cents:'0') && outcome.reason===piece.reason);
    fulfilled ||= piece.outcome==='completed';
    gross+=BigInt(String(p.gross_inclusive_cents));discount+=BigInt(String(p.discount_inclusive_cents));amount+=BigInt(String(p.amount_cents));
   }
   check(gross===BigInt(String(prior.gross_inclusive_cents)) && discount===BigInt(String(prior.discount_inclusive_cents))
    && amount===BigInt(String(prior.amount_cents)));
  }
  // A particular plan may be entirely unfulfilled; the complete operation must
  // still contain explicit fulfilled identity, including legitimate free work.
  check(fulfilled || field.rows.work_scope_outcomes.some(o=>o.operation_id===plan.operation_id && o.outcome==='completed'));
 } else {
  check(event.to_state==='cancelled');
  if(kind==='operations.job.interrupt')check(event.from_state==='en_route' && body.action==='cancel');
  else check(['in_progress','paused'].includes(String(event.from_state)) && body.noFulfilledScopeConfirmed===true);
  const entries=body.scope.filter(s=>s.sourceAllocationId===plan.source_allocation_id);check(entries.length===1);
  check(entries[0]!.expectedPlanId===previous.id && entries[0]!.expectedSequence===previous.sequence);
  for(const prior of previousParts) {
   const p=take(prior.stable_partition_id),expected=content(prior);
   if(prior.job_id===event.job_id) {check(prior.allocation_state==='assigned');expected.state='cancelled';}
   check(same(content(p),expected));
   if(kind==='operations.job.cancel_unfulfilled' && prior.job_id===event.job_id) {
    const outcomes=field.rows.work_scope_outcomes.filter(o=>o.completion_part_id===p.id);check(outcomes.length===1);
    const o=outcomes[0]!;
    check(o.operation_id===plan.operation_id && o.job_id===event.job_id && o.assigned_part_id===prior.id
     && o.partition_id===p.stable_partition_id && o.outcome==='cancelled' && o.scope_description===p.scope_description
     && o.completed_cents==='0' && o.reason===body.reason);
   }
  }
 }
 check(consumed.size===parts.length);
}
