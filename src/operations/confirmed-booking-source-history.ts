// Included-domain closure over supplied sources, not capture authority or backup.
import 'server-only';
import {createHash} from 'node:crypto';
import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {verifyBusinessFoundationEvidence} from '../security/business-configuration-evidence.ts';
import {formatBusinessFoundationBundle} from '../security/business-foundation-bundle.ts';
import {parseHistoryJson,historyJsonEqual,historyJsonNumber} from '../security/history-evidence-json.ts';
import {formatQuoteCommercialCsv} from '../commercial/quote-commercial-csv.ts';
import type {QuoteCommercialSourceInput} from '../commercial/quote-commercial-csv.ts';
import {formatBookingSourceCsv} from './confirmed-booking-source-csv.ts';
import type {BookingSourceInput} from './confirmed-booking-source-csv.ts';
import {bookingRecordGroups,bookingRecordSchema} from './confirmed-booking-records.ts';
import type {BookingRecordGroup} from './confirmed-booking-records.ts';
import {parseBookedJobCommitted,parseCancelledJobCommitted,requireBooking as check} from './confirmed-booking-contract.ts';
import {parseRescheduledJobCommitted} from './confirmed-reschedule-contract.ts';
import {parseFulfillmentModeCommitted} from './fulfillment-mode-contract.ts';

type Row=Readonly<Record<string,unknown>>;
type Input=Readonly<{source:BookingSourceInput;commercial:QuoteCommercialSourceInput;configuration:string;identity:string;history:string}>;
const commands=new Set(['operations.fulfillment_modes.initialize','operations.fulfillment_modes.save','operations.job.book','operations.job.reschedule','operations.job.cancel']);
const entities=new Set<string>(['fulfillment_modes',...bookingRecordGroups.filter(g=>g!=='fulfillment_mode_versions')]);
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
function object(v:unknown):asserts v is Record<string,unknown>{check(!!v&&typeof v==='object'&&!Array.isArray(v));}
function projection(group:BookingRecordGroup,row:Row){
 const image=parseHistoryJson(JSON.stringify(row));object(image);
 for(const [key,spec]of Object.entries(bookingRecordSchema[group]))if((spec.type==='jsonb'||spec.type==='tstzrange')&&row[key]!==null){check(typeof row[key]==='string');image[key]=parseHistoryJson(row[key]);}
 return image;
}
function delta(row:Row){check(typeof row.delta==='string');const v=parseHistoryJson(row.delta);check(exact(v,['schemaVersion','before','after'])&&historyJsonNumber(v.schemaVersion,1));return v;}
export function formatBookingSourceHistory(input:Input){
 check(exact(input,['source','commercial','configuration','identity','history']));
 const source=formatBookingSourceCsv(input.source),businessId=input.source.businessId;
 const foundation=verifyBusinessFoundationEvidence(input.configuration,input.identity,input.history,{businessId});
 check(foundation.history.context.snapshotToken===input.source.historySnapshotToken&&input.commercial.businessId===businessId&&input.commercial.snapshotToken===input.source.commercialSnapshotToken&&input.commercial.historyEvidence===input.history);
 const commercial=formatQuoteCommercialCsv(input.commercial),operations=new Map<string,Row>(),allAudits=new Map<string,Row>(),domainAudits=new Map<string,Row[]>(),domainOperations=new Map<string,Row>();
 for(const record of foundation.history.records){
  const row=JSON.parse(record.canonicalEvidence).row as Row;
  if(record.kind==='operation'){operations.set(row.operation_id as string,row);if(commands.has(row.command_type as string))domainOperations.set(row.operation_id as string,row);}
  else {const included=entities.has(row.entity_kind as string),key=included?[row.entity_kind,row.entity_id,row.entity_version].join(':'):'audit:'+row.id;check(!allAudits.has(key));allAudits.set(key,row);if(included){const entity=[row.entity_kind,row.entity_id].join(':');const list=domainAudits.get(entity)??[];list.push(row);domainAudits.set(entity,list);}}
 }
 const sourceImages=new Map<string,Row>(),usedSource=new Set<string>(),usedOperations=new Set<string>(),usedAudits=new Set<string>(),requiredActors=new Set<string>();
 for(const group of bookingRecordGroups)for(const row of input.source.rows[group]){
  const key=group==='fulfillment_mode_versions'?['fulfillment_modes',businessId,row.sequence].join(':'):[group,row.id,group==='jobs'?row.version:'1'].join(':');
  check(!sourceImages.has(key));sourceImages.set(key,projection(group,row));
  for(const actor of [row.created_by,row.updated_by,row.operator_actor_id])if(actor!==undefined){check(uuid(actor)&&foundation.requiredActorIds.includes(actor));requiredActors.add(actor);}
 }
 for(const [entity,audits]of domainAudits){
  audits.sort((a,b)=>BigInt(a.entity_version as string)<BigInt(b.entity_version as string)?-1:1);
  let before:unknown=null;
  for(const [index,audit]of audits.entries()){
   const kind=audit.entity_kind as string,group=(kind==='fulfillment_modes'?'fulfillment_mode_versions':kind) as BookingRecordGroup,operation=domainOperations.get(audit.operation_id as string),v=delta(audit),revision=String(index+1);
   check(operation&&audit.entity_version===revision&&operation.actor_id===audit.actor_id&&operation.created_by===operation.actor_id&&operation.origin==='manual'&&operation.import_row_id===null&&audit.created_by===audit.actor_id&&audit.origin==='manual'&&audit.import_row_id===null&&historyJsonEqual(v.before,before));
   const release=kind==='schedule_reservations'&&revision==='2';
   check(audit.action===(kind==='fulfillment_modes'?index===0?'initialize':'revise':release?'release':index===0?'create':'revise'));
   check(kind==='jobs'||kind==='fulfillment_modes'||kind==='schedule_reservations'&&index<=1||index===0);
   if(release){check(v.after===null&&['operations.job.cancel','operations.job.reschedule'].includes(operation.command_type as string));}
   else {
    object(v.after);check(exact(v.after,Object.keys(bookingRecordSchema[group]))&&v.after.business_id===businessId&&v.after.origin==='manual'&&v.after.operation_id===audit.operation_id);
    check(kind==='fulfillment_modes'?audit.entity_id===businessId&&v.after.sequence===revision:v.after.id===audit.entity_id);
    check(kind==='jobs'?v.after.version===revision&&v.after.updated_by===audit.actor_id:v.after.created_by===audit.actor_id);
    if(kind==='fulfillment_modes')check(operation.command_type===(index===0?operation.command_type==='operations.job.book'?'operations.job.book':'operations.fulfillment_modes.initialize':'operations.fulfillment_modes.save'));
    else check(['operations.job.book','operations.job.reschedule','operations.job.cancel'].includes(operation.command_type as string));
    const sourceKey=[kind,audit.entity_id,kind==='fulfillment_modes'||kind==='jobs'?revision:'1'].join(':');
    const image=sourceImages.get(sourceKey);
    if(kind==='fulfillment_modes'||kind!=='jobs'&&kind!=='schedule_reservations'||index===audits.length-1){
     // Released reservation rows exist only in retained before/after history.
     if(!(kind==='schedule_reservations'&&audits.length===2)){check(image&&historyJsonEqual(image,v.after));usedSource.add(sourceKey);}
    }
   }
   before=v.after;usedOperations.add(audit.operation_id as string);usedAudits.add(audit.id as string);requiredActors.add(audit.actor_id as string);
  }
  if(audits[0]!.entity_kind==='schedule_reservations'&&audits.length===2)check(!sourceImages.has(entity+':1'));
 }
 check(usedSource.size===sourceImages.size&&usedOperations.size===domainOperations.size&&[...requiredActors].every(a=>foundation.requiredActorIds.includes(a)));
 const sourceMaps=Object.fromEntries(bookingRecordGroups.map(g=>[g,new Map(input.source.rows[g].map(r=>[r.id,r]))])) as Record<BookingRecordGroup,Map<unknown,Row>>;
 for(const [id,operation]of domainOperations){
  check(usedOperations.has(id)&&operation.state==='committed'&&operation.schema_version===1&&operation.result_schema_version===1&&typeof operation.result==='string');
  const result=JSON.parse(operation.result) as Row,wire={state:'committed',operationId:id,recoveryEpoch:operation.recovery_epoch,receipt:result},audits=[...allAudits.values()].filter(a=>a.operation_id===id);
  if((operation.command_type as string).startsWith('operations.fulfillment_modes.')){
   const receipt=parseFulfillmentModeCommitted(wire,businessId,id).receipt,audit=allAudits.get(['fulfillment_modes',businessId,receipt.sequence].join(':'));
   check(audits.length===1&&audit?.id===receipt.auditEventId&&audit.operation_id===id&&delta(audit).after!==null&&sourceMaps.fulfillment_mode_versions.get(receipt.versionId)?.operation_id===id);
  }else{
   const receipt=operation.command_type==='operations.job.book'?parseBookedJobCommitted(wire,businessId,id).receipt:operation.command_type==='operations.job.cancel'?parseCancelledJobCommitted(wire,businessId,id).receipt:parseRescheduledJobCommitted(wire,businessId,id).receipt;
   check(receipt.sourceAuditIds.length===audits.length&&audits.every(a=>entities.has(a.entity_kind as string)&&receipt.sourceAuditIds.includes(a.id as string)));
   const jobAudit=allAudits.get(['jobs',receipt.jobId,receipt.version].join(':'));check(jobAudit?.id===receipt.jobAuditEventId&&jobAudit.operation_id===id);
   const jobImage=delta(jobAudit).after;object(jobImage);
   const appointmentId='latestAppointmentId' in receipt?receipt.latestAppointmentId:receipt.appointmentId,appointment=sourceMaps.appointments.get(appointmentId);
   check(appointment?.job_id===receipt.jobId&&appointment.operation_id===id&&appointment.sequence===receipt.appointmentSequence&&jobImage.current_appointment_id===('currentAppointmentId' in receipt?receipt.currentAppointmentId:appointmentId));
   const events=input.source.rows.job_events.filter(e=>e.operation_id===id);check(events.length===1&&events[0]!.job_id===receipt.jobId&&events[0]!.sequence===receipt.version);
   const evidence=parseHistoryJson(events[0]!.evidence as string);object(evidence);object(evidence.request);check(evidence.request.operationId===id&&evidence.request.recoveryEpoch===operation.recovery_epoch&&evidence.request.businessId===businessId&&evidence.request.jobId===receipt.jobId);
  }
 }
 // Retained CRM images, rather than today's mutable values, bind job snapshots.
 const crmReferenceIds=new Set<string>();
 function crm(kind:'customers'|'vehicles'|'addresses'|'customer_vehicles',id:unknown,version?:unknown,snapshot?:unknown){
  check(uuid(id));const candidates=[...allAudits.values()].filter(a=>a.entity_kind===kind&&a.entity_id===id&&(version===undefined||a.entity_version===version));check(candidates.length>0);
  const found=candidates.some(a=>{const image=delta(a).after;if(!image||typeof image!=='object'||Array.isArray(image))return false;const row=image as Row;return row.id===id&&row.business_id===businessId&&(snapshot===undefined||historyJsonEqual(image,snapshot));});check(found);crmReferenceIds.add(kind+':'+id);
 }
 function location(value:unknown,customerId:unknown){
  if(value===null)return;object(value);if(value.kind==='manual')return;check(value.kind==='customer_address');object(value.snapshot);check(value.snapshot.customer_id===customerId);crm('addresses',value.addressId,value.addressVersion,value.snapshot);
 }
 for(const job of input.source.rows.jobs){crm('customers',job.customer_id);location(parseHistoryJson(job.work_location_snapshot as string),job.customer_id);}
 for(const row of input.source.rows.job_vehicles){
  const customer=parseHistoryJson(row.customer_snapshot as string),vehicle=parseHistoryJson(row.vehicle_snapshot as string);object(customer);object(vehicle);crm('customers',customer.id,customer.version,customer);crm('vehicles',vehicle.id,vehicle.version,vehicle);
  if(row.customer_vehicle_id!==null){crm('customer_vehicles',row.customer_vehicle_id);const matches=[...allAudits.values()].some(a=>{if(a.entity_kind!=='customer_vehicles'||a.entity_id!==row.customer_vehicle_id)return false;const image=delta(a).after;return !!image&&typeof image==='object'&&(image as Row).customer_id===customer.id&&(image as Row).vehicle_id===vehicle.id;});check(matches);}
  for(const [idKey,snapshotKey]of [['pickup_address_id','pickup_location_snapshot'],['return_address_id','return_location_snapshot']] as const){const value=row[snapshotKey]===null?null:parseHistoryJson(row[snapshotKey] as string);location(value,customer.id);if(row[idKey]!==null){object(value);check(value.addressId===row[idKey]);}}
 }
 const allocations=new Map(input.commercial.rows.allocations.map(r=>[r.id,r])),agreements=new Map(input.commercial.rows.agreements.map(r=>[r.id,r])),entitlements=new Map(input.commercial.rows.entitlements.map(r=>[r.id,r]));
 for(const encounter of input.source.rows.job_encounters){const agreement=agreements.get(encounter.agreement_id as string);check(agreement&&agreement.family_id===encounter.family_id&&agreement.customer_id===encounter.customer_id);}
 for(const plan of input.source.rows.allocation_plan_versions){
  const original=allocations.get(plan.source_allocation_id as string);check(original);const agreement=agreements.get(original.agreement_id as string),entitlement=entitlements.get(original.entitlement_id as string);check(agreement&&entitlement);
  const parts=input.source.rows.allocation_plan_parts.filter(p=>p.plan_id===plan.id);check(parts.length>0);
  for(const column of ['gross_inclusive_cents','discount_inclusive_cents','amount_cents'])check(parts.reduce((n,p)=>n+BigInt(p[column] as string),0n)===BigInt(original[column] as string));
  if(original.amount_cents==='0')check(parts.length===1&&parts[0]!.stable_partition_id===original.stable_partition_id);
  for(const part of parts)if(part.job_id!==null){const job=sourceMaps.jobs.get(part.job_id);check(job&&job.customer_id===agreement.customer_id&&input.source.rows.job_encounters.some(e=>e.job_id===job.id&&e.agreement_id===agreement.id));if(entitlement.vehicle_id!==null)check(input.source.rows.job_vehicles.some(v=>v.job_id===job.id&&v.vehicle_id===entitlement.vehicle_id));}
 }
 const base=formatBusinessFoundationBundle({configuration:input.configuration,identity:input.identity,history:input.history},{businessId}).forServer(),parts:{name:string;content:string}[]=[];
 const add=(name:string,content:string)=>{check(/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/.test(name));const prior=parts.find(p=>p.name===name);if(prior){check(prior.content===content);return;}parts.push({name,content});};
 // Preserve the established flat private-file namespace. Shared foundation /
 // commercial history files may coalesce only when their exact bytes agree.
 for(const p of base.parts)add(p.name,p.content);add('foundation_manifest.json',base.manifest);
 for(const group of bookingRecordGroups){const t=source.tables[group];add(group+'.csv',t.csv);add(group+'_escape_map.json',t.escapeMap);add(group+'_dictionary.json',t.dictionary);}
 add('booking_source_references.json',source.references);add('booking_source_manifest.json',source.manifest);
 for(const [name,content]of Object.entries(commercial.files))add(name,content);add('quote_commercial_manifest.json',commercial.manifest);
 const quoteNames={familiesCsv:'quote_families.csv',revisionsCsv:'quote_revisions.csv',itemsCsv:'quote_items.csv',assessmentsCsv:'condition_assessments.csv',approvalsCsv:'quote_approvals.csv',escapeMap:'quote_review_escape_map.json',dictionary:'quote_review_dictionary.json',manifest:'quote_review_manifest.json'};
 for(const name of Object.keys(quoteNames) as (keyof typeof quoteNames)[])add(quoteNames[name],commercial.quoteFiles[name]);
 const historySuffix=(name:string)=>name==='csv'?'.csv':name==='escapeMap'?'_escape_map.json':'_dictionary.json';
 for(const [name,content]of Object.entries(commercial.historyFiles.operations))add('operations'+historySuffix(name),content);
 for(const [name,content]of Object.entries(commercial.historyFiles.audits))add('audit_events'+historySuffix(name),content);add('history_manifest.json',commercial.historyFiles.manifest);
 const manifest=JSON.stringify({schemaVersion:1,scope:'confirmed_booking_source_history',businessId,generationId:foundation.generationId,snapshotToken:input.source.snapshotToken,commercialSnapshotToken:input.source.commercialSnapshotToken,historySnapshotToken:input.source.historySnapshotToken,includedBookingHistoryReferencesVerified:true,includedCommercialAssignmentsVerified:true,includedHistoricalCrmReferencesVerified:true,bookingOperations:usedOperations.size,bookingAudits:usedAudits.size,historicalCrmReferences:[...crmReferenceIds].sort(),requiredBookingActorIds:[...requiredActors].sort(),parts:parts.map(p=>({name:p.name,bytes:Buffer.byteLength(p.content),sha256:sha(p.content)})),assurance:'supplied_source_consistency_only',consistentCaptureProven:false,referenceClosureComplete:false,completePortableExport:false,completeBackup:false})+'\n';
 check(parts.length<=1024&&parts.every(p=>Buffer.byteLength(p.content)<=8*1024*1024)&&Buffer.byteLength(manifest)+parts.reduce((n,p)=>n+Buffer.byteLength(p.content),0)<=64*1024*1024);
 return Object.freeze({manifest,parts:Object.freeze(parts.map(p=>Object.freeze(p)))});
}
