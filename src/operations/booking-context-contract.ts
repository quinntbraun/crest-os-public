// Current scheduling projections. Historical accepted agreement/export/hash
// data remain separate; these reads grant no mutation authority.
import {customerUuid as uuid,customerVersion as version,customerInstant as instant,exactCustomerObject as exact,parseCustomer} from '../customer/customer-contract.ts';
import {parseFulfillmentModeVersion} from './fulfillment-mode-contract.ts';
import {parseJobDetail} from './confirmed-job-read-contract.ts';
import {parseBookingRecord} from './confirmed-booking-records.ts';
import {validateScopeAllocationPlan} from './scope-allocation-plan.ts';
import type {AllocationPart} from './scope-allocation-plan.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
function text(v:unknown,max:number):v is string{return typeof v==='string'&&v.trim().length>0&&[...v].length<=max&&[...v].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||[9,10,13].includes(n));});}
function unique(rows:readonly string[]){check(new Set(rows).size===rows.length);}
export function parseBookingWorkspace(v:unknown,businessId:string){
 check(uuid(businessId)&&exact(v,['schemaVersion','businessId','operatorId','timezone','modeVersion'])&&v.schemaVersion===1&&v.businessId===businessId&&uuid(v.operatorId)&&typeof v.timezone==='string'&&v.timezone.length<=100);new Intl.DateTimeFormat('en-US',{timeZone:v.timezone});
 return Object.freeze({schemaVersion:1 as const,businessId,operatorId:v.operatorId,timezone:v.timezone,modeVersion:v.modeVersion===null?null:parseFulfillmentModeVersion(v.modeVersion,businessId)});
}
export type CurrentBookingSource=Readonly<{sourceAllocationId:string;entitlementId:string;entitlementVersionId:string;agreementId:string;sourcePartitionId:string;vehicleId:string|null;jobWide:boolean;grossInclusiveCents:string;discountInclusiveCents:string;amountCents:string;scopeDescription:string;planId:string|null;planSequence:string;parts:readonly AllocationPart[]}>;
export type OriginalBookingSource=Readonly<{agreementId:string;entitlementVersionId:string;grossInclusiveCents:string;discountInclusiveCents:string;amountCents:string;scopeDescription:string}>;
export type CurrentBookingSourceV2=CurrentBookingSource&Readonly<{authorizationState:'active'|'withdrawn';original:OriginalBookingSource}>;
export function parseBookingAgreement(v:unknown,businessId:string,familyId:string){
 check(uuid(businessId)&&uuid(familyId));if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
 check(v!==null&&typeof v==='object');const modern=(v as Record<string,unknown>).schemaVersion===2;
 check(exact(v,['schemaVersion','businessId','familyId','familyVersion','agreementId','agreementVersion','customer','vehicles','sources',...(modern?['totalCents','sourceCount']:[])])&&(v.schemaVersion===1||modern)&&v.businessId===businessId&&v.familyId===familyId&&version(v.familyVersion)&&uuid(v.agreementId)&&version(v.agreementVersion)&&Array.isArray(v.vehicles)&&Array.isArray(v.sources)&&v.sources.length>0&&v.sources.length<=1000&&(!modern||(version(v.totalCents,true)&&Number.isSafeInteger(v.sourceCount)&&v.sourceCount===v.sources.length)));
 const customer=parseCustomer(v.customer,businessId),vehicles=v.vehicles.map(row=>{check(exact(row,['id','label','version','archivedAt'])&&uuid(row.id)&&text(row.label,200)&&version(row.version)&&(row.archivedAt===null||instant(row.archivedAt)));return Object.freeze({...row}) as Readonly<{id:string;label:string;version:string;archivedAt:string|null}>;});unique(vehicles.map(row=>row.id));
 let partCount=0;const sources=v.sources.map((row):CurrentBookingSource|CurrentBookingSourceV2=>{
  check(exact(row,['sourceAllocationId','entitlementId','entitlementVersionId','agreementId','sourcePartitionId','vehicleId','jobWide','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription','planId','planSequence','parts',...(modern?['authorizationState','original']:[])])&&[row.sourceAllocationId,row.entitlementId,row.entitlementVersionId,row.sourcePartitionId].every(uuid)&&row.agreementId===v.agreementId&&(row.vehicleId===null||uuid(row.vehicleId))&&typeof row.jobWide==='boolean'&&row.jobWide===(row.vehicleId===null)&&text(row.scopeDescription,2000)&&version(row.planSequence,true)&&(row.planSequence==='0'?row.planId===null:uuid(row.planId))&&Array.isArray(row.parts));
  partCount+=row.parts.length;check(partCount<=10000);let original:OriginalBookingSource|undefined;
  check(!modern||v.agreementVersion==='1'||row.planSequence!=='0');
  if(modern){const r=row.original;check(exact(r,['agreementId','entitlementVersionId','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'])&&uuid(r.agreementId)&&uuid(r.entitlementVersionId)&&[r.grossInclusiveCents,r.discountInclusiveCents,r.amountCents].every(n=>version(n,true))&&BigInt(r.grossInclusiveCents as string)-BigInt(r.discountInclusiveCents as string)===BigInt(r.amountCents as string)&&text(r.scopeDescription,2000)&&['active','withdrawn'].includes(row.authorizationState as string));original=Object.freeze({...r}) as OriginalBookingSource;}
  const withdrawn=modern&&row.authorizationState==='withdrawn';let parts:readonly AllocationPart[];
  if(withdrawn){check(row.grossInclusiveCents==='0'&&row.discountInclusiveCents==='0'&&row.amountCents==='0'&&row.parts.length===0&&row.planSequence!=='0'&&v.agreementVersion!=='1'&&original?.agreementId!==row.agreementId);parts=Object.freeze([]);}
  else{parts=validateScopeAllocationPlan({id:row.sourceAllocationId,grossInclusiveCents:row.grossInclusiveCents,discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents},row.parts).parts;
   if(row.planSequence==='0')check(parts.length===1&&parts[0]!.state==='unassigned'&&parts[0]!.partitionId===row.sourcePartitionId&&parts[0]!.scopeDescription===row.scopeDescription);
   if(row.amountCents==='0')check(parts.length===1&&parts[0]!.partitionId===row.sourcePartitionId);
  }
  check(row.vehicleId===null||vehicles.some(vehicle=>vehicle.id===row.vehicleId));return Object.freeze({...row,parts,...(modern?{original}: {})}) as CurrentBookingSource|CurrentBookingSourceV2;
 });unique(sources.map(row=>row.sourceAllocationId));unique(sources.map(row=>row.entitlementId));unique(sources.flatMap(row=>row.parts.map(p=>row.sourceAllocationId+'/'+p.partitionId)));check(vehicles.every(vehicle=>sources.some(source=>source.vehicleId===vehicle.id)));
 const common={businessId,familyId,familyVersion:v.familyVersion,agreementId:v.agreementId,agreementVersion:v.agreementVersion,customer,vehicles:Object.freeze(vehicles),sources:Object.freeze(sources)};if(modern){unique(sources.map(row=>row.entitlementVersionId));unique(sources.flatMap(row=>row.parts.map(p=>p.partitionId)));check(sources.reduce((n,s)=>n+BigInt(s.amountCents),0n)===BigInt(v.totalCents as string));return Object.freeze({...common,schemaVersion:2 as const,totalCents:v.totalCents as string,sourceCount:v.sourceCount as number});}return Object.freeze({...common,schemaVersion:1 as const});
}
export type CurrentJobScopePart=Readonly<{sourceAllocationId:string;entitlementId:string;entitlementVersionId:string;agreementId:string;planId:string;planSequence:string}>&AllocationPart;
export type AmendedJobScopePart=CurrentJobScopePart&Readonly<{familyId:string;encounterAgreementId:string}>;
export function parseJobResources(v:unknown,businessId:string,jobId:string){
 check(uuid(businessId)&&uuid(jobId));if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(v,['schemaVersion','businessId','jobId','head','vehicles','encounters','scopeParts'])&&(v.schemaVersion===1||v.schemaVersion===2)&&v.businessId===businessId&&v.jobId===jobId&&Array.isArray(v.vehicles)&&Array.isArray(v.encounters)&&Array.isArray(v.scopeParts));const modern=v.schemaVersion===2;
 const head=parseJobDetail(v.head,businessId,jobId);check(!('state' in head)&&v.vehicles.length===head.vehicleCount&&v.encounters.length===head.encounterCount&&v.scopeParts.length===head.allocationCount);
 const vehicles=v.vehicles.map(row=>{const r=parseBookingRecord('job_vehicles',row,businessId);check(r.job_id===jobId&&r.customer_snapshot.id===head.job.customer_id);return r;}),encounters=v.encounters.map(row=>{const r=parseBookingRecord('job_encounters',row,businessId);check(r.job_id===jobId&&r.customer_id===head.job.customer_id);return r;});unique(vehicles.map(row=>row.id));unique(vehicles.map(row=>row.vehicle_id));unique(encounters.map(row=>row.id));
 if(modern)unique(encounters.map(row=>row.family_id));
 const scopeParts=v.scopeParts.map(row=>{
  check(exact(row,['sourceAllocationId','entitlementId','entitlementVersionId','agreementId','planId','planSequence','partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription',...(modern?['familyId','encounterAgreementId']:[])])&&[row.sourceAllocationId,row.entitlementId,row.entitlementVersionId,row.agreementId,row.planId,row.partitionId].every(uuid)&&version(row.planSequence)&&row.jobId===jobId&&['assigned','completed','cancelled'].includes(row.state as string)&&text(row.scopeDescription,2000));
  check(modern?uuid(row.familyId)&&uuid(row.encounterAgreementId)&&encounters.some(e=>e.family_id===row.familyId&&e.agreement_id===row.encounterAgreementId):encounters.some(e=>e.agreement_id===row.agreementId));
  const part=Object.fromEntries(['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'].map(k=>[k,row[k]]));validateScopeAllocationPlan({id:row.sourceAllocationId,grossInclusiveCents:row.grossInclusiveCents,discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents},[part]);return Object.freeze({...row}) as CurrentJobScopePart|AmendedJobScopePart;
 });unique(scopeParts.map(row=>row.sourceAllocationId+'/'+row.partitionId));const common={businessId,jobId,head,vehicles:Object.freeze(vehicles),encounters:Object.freeze(encounters)};return modern?Object.freeze({...common,schemaVersion:2 as const,scopeParts:Object.freeze(scopeParts as AmendedJobScopePart[])}):Object.freeze({...common,schemaVersion:1 as const,scopeParts:Object.freeze(scopeParts as CurrentJobScopePart[])});
}
export type PendingChangesRequest=Readonly<{businessId:string;afterCreatedAt:string|null;afterAppointmentId:string|null;pageSize:number}>;
export function parsePendingChangesRequest(v:unknown):PendingChangesRequest{
 check(exact(v,['businessId','afterCreatedAt','afterAppointmentId','pageSize'])&&uuid(v.businessId)&&(v.afterCreatedAt===null)===(v.afterAppointmentId===null)&&(v.afterCreatedAt===null||instant(v.afterCreatedAt)&&uuid(v.afterAppointmentId))&&typeof v.pageSize==='number'&&Number.isInteger(v.pageSize)&&v.pageSize>=1&&v.pageSize<=20);return Object.freeze({...v}) as PendingChangesRequest;
}
export function parsePendingChangesPage(v:unknown,input:PendingChangesRequest){
 const request=parsePendingChangesRequest(input);check(exact(v,['schemaVersion','businessId','items','hasMore'])&&v.schemaVersion===1&&v.businessId===request.businessId&&Array.isArray(v.items)&&v.items.length<=request.pageSize&&typeof v.hasMore==='boolean'&&(!v.hasMore||v.items.length===request.pageSize));let stamp=request.afterCreatedAt,id=request.afterAppointmentId;const jobs=new Set<string>();
 const items=v.items.map(row=>{check(exact(row,['proposedAt','head'])&&instant(row.proposedAt)&&row.head!==null&&typeof row.head==='object'&&!Array.isArray(row.head));const raw=row.head as Record<string,unknown>;check(raw.job!==null&&typeof raw.job==='object'&&!Array.isArray(raw.job));const head=parseJobDetail(raw,request.businessId,(raw.job as Record<string,unknown>).id as string);check(!('state' in head)&&!['completed','cancelled'].includes(head.job.state)&&head.latestAppointment.confirmation_state==='proposed'&&BigInt(head.latestAppointment.sequence)>BigInt(head.appointment.sequence)&&head.latestAppointment.created_at===row.proposedAt&&!jobs.has(head.job.id));jobs.add(head.job.id);
  check(stamp===null||row.proposedAt>stamp||row.proposedAt===stamp&&head.latestAppointment.id>(id as string));stamp=row.proposedAt;id=head.latestAppointment.id;return Object.freeze({proposedAt:row.proposedAt,head});
 });return Object.freeze({schemaVersion:1 as const,businessId:request.businessId,items:Object.freeze(items),hasMore:v.hasMore});
}
