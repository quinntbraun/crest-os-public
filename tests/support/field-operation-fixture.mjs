import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {parseFieldOriginal} from '../../src/operations/field-original-contract.ts';
export function createFieldOperationFixture({client,web,accepted}){
 const value=async(c,q,args=[])=>(await c.query(q,args)).rows[0].value;
 const scalar=(q,args=[])=>value(client,q,args);
 const location=text=>({schemaVersion:1,kind:'manual',locationText:text,instructions:null});
async function fixture({contact=false}={}){
 const p=await accepted(null);p.rig=randomUUID();assert.equal((await value(web,'SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) value',[...p.auth(),p.epoch,randomUUID(),p.rig,{label:'Synthetic field-original rig',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'business_rig',notes:null,archived:false,archiveReason:null}])).state,'committed');
 const q=confirmedBookingRequest(p);if(contact){assert.equal((await value(web,'SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) value',[...p.auth(),p.epoch,randomUUID(),p.customer,{displayName:'Synthetic field-source customer',phone:'+12025550123',email:null,contactPreference:'phone',outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}])).state,'committed');q.payload.expectedCustomerVersion='2';q.payload.appointment.contact_snapshot={kind:'phone',value:'+12025550123'};}p.booked=await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,q.operationId,q.jobId,q.expectedModeSequence,q.payload]);assert.equal(p.booked.state,'committed');p.job=q.jobId;p.version='1';p.booking=q;return p;
}
async function field(p,action){const body={action,reason:action==='direct_arrive'?'Synthetic omitted outbound travel':action==='pause'?'Synthetic pause':null,...(action==='depart'?{trip:{drivenVehicleId:p.rig,origin:location('Synthetic base'),etaAt:null,notes:null}}:{})};const r=await value(web,'SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),p.job,p.version,body]);assert.equal(r.state,'committed');p.version=r.receipt.jobVersion;return r;}
async function scope(p){return (await client.query('SELECT DISTINCT source_allocation_id,plan_id,plan_sequence::text,entitlement_version_id FROM crest.current_scope_allocation_parts WHERE business_id=$1 AND job_id=$2 ORDER BY source_allocation_id',[p.business,p.job])).rows.map(r=>({sourceAllocationId:r.source_allocation_id,expectedPlanId:r.plan_id,expectedSequence:r.plan_sequence,entitlementVersionId:r.entitlement_version_id}));}
async function completion(p){return {scope:(await client.query("SELECT a.id,v.id plan_id,v.sequence::text,a.stable_partition_id,a.gross_inclusive_cents::text,a.discount_inclusive_cents::text,a.amount_cents::text,a.scope_description FROM crest.current_scope_allocation_parts current JOIN crest.allocation_plan_parts a ON a.business_id=current.business_id AND a.plan_id=current.plan_id AND a.stable_partition_id=current.stable_partition_id JOIN crest.allocation_plan_versions v ON v.business_id=a.business_id AND v.id=a.plan_id WHERE current.business_id=$1 AND current.job_id=$2 AND current.allocation_state='assigned' ORDER BY a.id",[p.business,p.job])).rows.map(a=>({assignedPartId:a.id,expectedPlanId:a.plan_id,expectedPlanSequence:a.sequence,pieces:[{partitionId:a.stable_partition_id,outcome:'completed',scopeDescription:a.scope_description,grossInclusiveCents:a.gross_inclusive_cents,discountInclusiveCents:a.discount_inclusive_cents,amountCents:a.amount_cents,reason:null}]})),reason:null,walkthrough:{state:'done',reason:null},review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,expectedDuplicateRequestIds:[],expectedCustomerVersion:'1',contactReviewReason:null}};}
const tripBody=p=>({action:'record',reason:'Synthetic omitted support trip',trip:{drivenVehicleId:p.rig,jobId:p.job,purpose:'return_to_base',origin:location('Synthetic work site'),destination:location('Synthetic base'),notes:null,departedAt:'2026-01-02T03:04:05.123456Z',arrivedAt:'2026-01-02T03:24:05.654321Z',state:'closed'}});
async function plan(kind){
 const p=await fixture(),operation=randomUUID();let name,tail,ref={operationId:operation,recoveryEpoch:p.epoch};
 if(kind==='operations.job.field'){
  name='change_field_session';tail=[p.job,p.version,{action:'direct_arrive',reason:'Synthetic recovery omission'}];ref={...ref,jobId:p.job,expectedJobVersion:p.version,action:'direct_arrive'};
 }else if(kind==='operations.job.complete'){
  await field(p,'direct_arrive');name='complete_job';tail=[p.job,p.version,await completion(p)];ref={...ref,jobId:p.job,expectedJobVersion:p.version};
 }else if(kind==='operations.job.interrupt'){
  const departed=await field(p,'depart');name='interrupt_mobile_job';tail=[p.job,p.version,{action:'cancel',reason:'Synthetic interrupted original trip',trip:{legId:departed.receipt.travelLegId,expectedLegVersionId:departed.receipt.travelLegId,actualStop:location('Synthetic actual stop')},expectedAppointmentId:await scalar('SELECT current_appointment_id value FROM crest.jobs WHERE id=$1',[p.job]),expectedModeSequence:null,appointment:null,conflictReview:null,customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null},scope:await scope(p)}];ref={...ref,jobId:p.job,expectedJobVersion:p.version,action:'cancel'};
 }else if(kind==='operations.job.cancel_unfulfilled'){
  await field(p,'direct_arrive');name='cancel_unfulfilled_job';tail=[p.job,p.version,{reason:'Synthetic no fulfilled scope',noFulfilledScopeConfirmed:true,expectedWorkIntervalId:await scalar('SELECT id value FROM crest.current_work_intervals WHERE business_id=$1 AND job_id=$2 AND ended_at IS NULL',[p.business,p.job]),expectedOpenTravelLegVersionIds:[],customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null},scope:await scope(p)}];ref={...ref,jobId:p.job,expectedJobVersion:p.version};
 }else{
  const leg=randomUUID();let first;
  if(kind!=='operations.support_trip.record'){first=await value(web,'SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),leg,null,tripBody(p)]);assert.equal(first.state,'committed');}
  if(kind==='operations.mileage.record'){
   name='record_mileage';tail=[leg,first.receipt.legVersionId,'0',{source:'manual_actual',movementKind:'business_rig',actualMiles:'10.5000',estimateMiles:null,estimateSource:null,odometerStart:null,odometerEnd:null,notes:null,reason:null,allocationState:'unallocated',allocations:[]}];ref={...ref,legId:leg,expectedLegVersionId:first.receipt.legVersionId,expectedEvidenceVersion:'0'};
  }else{
   name='record_support_trip';const body=kind==='operations.support_trip.record'?{action:'depart',reason:null,trip:{...tripBody(p).trip}}:{...tripBody(p),action:'correct',reason:'Synthetic corrected original trip'};
   if(kind==='operations.support_trip.record')for(const k of ['departedAt','arrivedAt','state'])delete body.trip[k];
   tail=[leg,first?.receipt.legVersionId??null,body];ref={...ref,legId:leg,expectedLegVersionId:first?.receipt.legVersionId??null,action:body.action};
  }
 }
 const args=[...p.auth(),p.epoch,operation,...tail];const placeholders=args.map((_,i)=>'$'+(i+1));placeholders.splice(10,0,'1');
 return {p,original:parseFieldOriginal({schemaVersion:1,businessId:p.business,commandType:kind,reference:ref}),sql:'SELECT crest_commands.'+name+'('+placeholders.join(',')+') value',args};
}
 return {fixture,field,scope,completion,tripBody,plan};
}
