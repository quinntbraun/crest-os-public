// Server-only included-source composition. This proves consistency of supplied
// source/history, never owner authority, capture authenticity or a full backup.
import 'server-only';
import {createHash} from 'node:crypto';
import {customerUuid,exactCustomerObject} from '../customer/customer-contract.ts';
import {formatCustomerCsv} from '../customer/customer-csv.ts';
import type {Customer} from '../customer/customer-contract.ts';
import {formatCustomerAddressCsv} from '../customer/customer-address-csv.ts';
import type {CustomerAddress} from '../customer/customer-address-contract.ts';
import {formatVehicleCsv} from '../customer/vehicle-csv.ts';
import type {Vehicle} from '../customer/vehicle-contract.ts';
import {formatVehicleAssociationCsv} from '../customer/vehicle-association-csv.ts';
import type {VehicleAssociationRow} from '../customer/vehicle-association-contract.ts';
import {verifyBusinessFoundationEvidence} from '../security/business-configuration-evidence.ts';
import {formatBusinessFoundationBundle} from '../security/business-foundation-bundle.ts';
import {parseHistoryJson,historyJsonEqual,historyJsonNumber} from '../security/history-evidence-json.ts';
import {formatFieldAcceptedQuoteAmendmentSourceCsv} from '../commercial/quote-amendment-source-csv.ts';
import type {AcceptedQuoteAmendmentSourceInput} from '../commercial/quote-amendment-source-csv.ts';
import {bookingRecordGroups,bookingRecordSchema} from './confirmed-booking-records.ts';
import type {BookingRecordGroup} from './confirmed-booking-records.ts';
import {amendedBookingRecordSchema} from './confirmed-booking-source-csv.ts';
import {fieldSourceGroups,fieldSourceSchema} from './field-source-schema.ts';
import {verifyFieldSources} from './field-source.ts';
import type {FieldSourceInput} from './field-source.ts';
import {parseBookedJobCommitted,parseCancelledJobCommitted} from './confirmed-booking-contract.ts';
import {parseRescheduledJobCommitted} from './confirmed-reschedule-contract.ts';
import {parseAmendedBookedJobCommitted,parseAmendedCancelledJobCommitted} from './amended-booking-contract.ts';
import {parseFulfillmentModeCommitted} from './fulfillment-mode-contract.ts';

type Row=Readonly<Record<string,unknown>>;
type Snapshot<T>=Readonly<{businessId:string;snapshotToken:string;expectedRowCount:string;rows:readonly T[]}>;
export type FieldWorkspaceSourceInput=Readonly<{
 configuration:string;identity:string;history:string;
 commercial:AcceptedQuoteAmendmentSourceInput;field:FieldSourceInput;
 crm:Readonly<{customers:Snapshot<Customer>;addresses:Snapshot<CustomerAddress>;vehicles:Snapshot<Vehicle>;associations:Snapshot<VehicleAssociationRow>}>;
}>;
export class FieldWorkspaceSourceError extends Error {
 constructor(){super('FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED');this.name='FieldWorkspaceSourceError';}
}
function check(v:unknown):asserts v{if(!v)throw new FieldWorkspaceSourceError();}
function object(v:unknown):asserts v is Record<string,unknown>{check(!!v&&typeof v==='object'&&!Array.isArray(v));}
const sha=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');
const commands={
 fulfillment_modes:['operations.fulfillment_modes.initialize','operations.fulfillment_modes.save','operations.job.book'],
 operator_controls:['operations.job.book','operations.support_trip.record'],
 jobs:['operations.job.book','operations.job.reschedule','operations.job.cancel','quote.amendment.accept','operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.job.work_start.correct','operations.job.work_end.correct'],
 appointments:['operations.job.book','operations.job.reschedule','operations.job.cancel','quote.amendment.accept','operations.job.interrupt','operations.job.cancel_unfulfilled'],
 schedule_reservations:['operations.job.book','operations.job.reschedule','operations.job.cancel','quote.amendment.accept','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled'],
 schedule_overrides:['operations.job.book','operations.job.reschedule','quote.amendment.accept','operations.job.interrupt'],
 schedule_override_conflicts:['operations.job.book','operations.job.reschedule','quote.amendment.accept','operations.job.interrupt'],
 allocation_plan_versions:['operations.job.book','operations.job.cancel','quote.amendment.accept','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled'],
 allocation_plan_parts:['operations.job.book','operations.job.cancel','quote.amendment.accept','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled'],
 job_vehicles:['operations.job.book'],job_encounters:['operations.job.book'],
 job_events:['operations.job.book','operations.job.reschedule','operations.job.cancel','quote.amendment.accept','operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.job.work_start.correct','operations.job.work_end.correct'],
} as const;
const fieldKinds=['operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.mileage.record','operations.support_trip.record','operations.support_trip.correct'];
function ids(actual:unknown,expected:readonly unknown[]){
 check(Array.isArray(actual)&&actual.every(customerUuid)&&new Set(actual).size===actual.length&&actual.length===expected.length&&expected.every(v=>typeof v==='string'&&actual.includes(v)));
}
function delta(a:Row){check(typeof a.delta==='string');const v=parseHistoryJson(a.delta);check(exactCustomerObject(v,['schemaVersion','before','after'])&&historyJsonNumber(v.schemaVersion,1));return v;}
function projection(group:BookingRecordGroup,row:Row){
 const image=parseHistoryJson(JSON.stringify(row));object(image);
 for(const [key,spec]of Object.entries(amendedBookingRecordSchema[group]))if((spec.type==='jsonb'||spec.type==='tstzrange')&&row[key]!==null){check(typeof row[key]==='string');image[key]=parseHistoryJson(row[key]);}
 // The documented legacy projection omits both later nullable fields.
 if(group==='allocation_plan_versions'&&row.entitlement_version_id===null){delete image.entitlement_version_id;delete image.authorization_state;}
 return image;
}

export function formatFieldWorkspaceSources(input:FieldWorkspaceSourceInput){
 try{
  check(exactCustomerObject(input,['configuration','identity','history','commercial','field','crm'])&&exactCustomerObject(input.crm,['customers','addresses','vehicles','associations']));
  const businessId=input.commercial.businessId;
  check(input.commercial.historyEvidence===input.history&&input.field.historyEvidence===input.history);
  const foundation=verifyBusinessFoundationEvidence(input.configuration,input.identity,input.history,{businessId});
  const field=verifyFieldSources(input.field),commercial=formatFieldAcceptedQuoteAmendmentSourceCsv(input.commercial,input.field);
  check(foundation.history.context.snapshotToken===input.commercial.bookings.historySnapshotToken&&field.context.historySnapshotToken===foundation.history.context.snapshotToken);
  const formattedCrm={customers:formatCustomerCsv(input.crm.customers),addresses:formatCustomerAddressCsv(input.crm.addresses),vehicles:formatVehicleCsv(input.crm.vehicles),associations:formatVehicleAssociationCsv(input.crm.associations)};
  for(const snapshot of Object.values(input.crm))check(snapshot.businessId===businessId);
  const operations=new Map<string,Row>(),audits:Row[]=[],chains=new Map<string,Row[]>();
  for(const r of foundation.history.records){const body=JSON.parse(r.canonicalEvidence) as {row:Row},row=body.row;
   if(r.kind==='operation'){check(typeof row.operation_id==='string'&&!operations.has(row.operation_id));operations.set(row.operation_id,row);}else audits.push(row);
  }
  const actorIds=new Set(foundation.requiredActorIds),configuration=foundation.configuration.records.map(r=>(JSON.parse(r.canonicalEvidence) as {row:Row}).row);
  const memberships=configuration.filter(r=>r.business_id===businessId&&typeof r.actor_id==='string');
  const memberIds=new Set(memberships.map(r=>r.actor_id));
  const actor=(id:unknown,member=true)=>check(customerUuid(id)&&actorIds.has(id)&&(!member||memberIds.has(id)));
  const operationFor=(a:Row)=>{const op=operations.get(String(a.operation_id));check(op&&op.actor_id===a.actor_id&&op.state==='committed'&&op.created_by===op.actor_id&&op.origin==='manual'&&op.import_row_id===null);actor(a.actor_id);check(a.created_by===a.actor_id&&a.origin==='manual'&&a.import_row_id===null);return op;};
  const sourceImages=new Map<string,unknown>(),usedSource=new Set<string>(),usedAudits=new Set<unknown>(),usedOperations=new Set<string>();
  for(const group of bookingRecordGroups)for(const row of input.commercial.bookings.rows[group]){
   const entity=group==='fulfillment_mode_versions'?'fulfillment_modes':group;
   const key=[entity,group==='fulfillment_mode_versions'?businessId:row.id,group==='fulfillment_mode_versions'?row.sequence:group==='jobs'?row.version:'1'].join(':');
   check(!sourceImages.has(key));sourceImages.set(key,projection(group,row));
   for(const key of ['created_by','updated_by','operator_actor_id'])if(row[key]!==undefined)actor(row[key]);
  }
  for(const a of audits)if(Object.hasOwn(commands,String(a.entity_kind))){const key=a.entity_kind+':'+a.entity_id,list=chains.get(key)??[];list.push(a);chains.set(key,list);}
  for(const [entity,values]of chains){
   values.sort((a,b)=>BigInt(String(a.entity_version))<BigInt(String(b.entity_version))?-1:1);let before:unknown=null;
   for(const [index,a]of values.entries()){
    const kind=String(a.entity_kind) as keyof typeof commands,group=(kind==='fulfillment_modes'?'fulfillment_mode_versions':kind) as BookingRecordGroup,op=operationFor(a),v=delta(a),revision=String(index+1);
    check(a.entity_version===revision&&historyJsonEqual(v.before,before)&&commands[kind].some(k=>k===op.command_type));
    const release=kind==='schedule_reservations'&&index===1;
    const acceptedPlan=op.command_type==='quote.amendment.accept'&&(kind==='allocation_plan_versions'||kind==='allocation_plan_parts');
    check(a.action===(acceptedPlan?'accept':kind==='fulfillment_modes'?index===0?'initialize':'revise':release?'release':index===0?'create':'revise'));
    check(kind==='jobs'||kind==='fulfillment_modes'||kind==='schedule_reservations'&&index<=1||index===0);
    if(release)check(v.after===null&&!['operations.job.book'].includes(String(op.command_type)));
    else{
     object(v.after);const schema=group==='allocation_plan_versions'&&Object.hasOwn(v.after,'entitlement_version_id')?amendedBookingRecordSchema[group]:bookingRecordSchema[group];
     check(exactCustomerObject(v.after,Object.keys(schema))&&v.after.business_id===businessId&&v.after.operation_id===a.operation_id&&v.after.origin==='manual');
     check(kind==='fulfillment_modes'?a.entity_id===businessId&&v.after.sequence===revision:v.after.id===a.entity_id);
     check(kind==='jobs'?v.after.version===revision&&v.after.updated_by===a.actor_id:v.after.created_by===a.actor_id);
     const key=[kind,a.entity_id,kind==='fulfillment_modes'||kind==='jobs'?revision:'1'].join(':');
     if(kind==='fulfillment_modes'||kind!=='jobs'&&kind!=='schedule_reservations'||index===values.length-1){
      if(!(kind==='schedule_reservations'&&values.length===2)){check(sourceImages.has(key)&&historyJsonEqual(sourceImages.get(key),v.after));usedSource.add(key);}
     }
    }
    before=v.after;check(!usedAudits.has(a.id));usedAudits.add(a.id);usedOperations.add(String(a.operation_id));
   }
   if(values[0]!.entity_kind==='schedule_reservations'&&values.length===2)check(!sourceImages.has(entity+':1'));
  }
  check(usedSource.size===sourceImages.size);
  // Current CRM sources and every retained version are tied to the original
  // before/after chain. Current values never substitute for historical snapshots.
  const crmRows:Record<string,readonly Row[]>={customers:input.crm.customers.rows,addresses:input.crm.addresses.rows,vehicles:input.crm.vehicles.rows,customer_vehicles:input.crm.associations.rows};
  for(const [kind,rows]of Object.entries(crmRows))for(const row of rows){
   const retained=audits.filter(a=>a.entity_kind===kind&&a.entity_id===row.id).sort((a,b)=>BigInt(String(a.entity_version))<BigInt(String(b.entity_version))?-1:1);check(retained.length>0);
   let before:unknown=null;for(const [index,a]of retained.entries()){operationFor(a);const v=delta(a);check(a.entity_version===String(index+1)&&historyJsonEqual(v.before,before));object(v.after);check(v.after.id===row.id&&v.after.business_id===businessId&&v.after.operation_id===a.operation_id);before=v.after;}
   check(String(retained.length)===row.version&&historyJsonEqual(before,parseHistoryJson(JSON.stringify(row))));actor(row.created_by);actor(row.updated_by);
  }
  const parents:Record<string,readonly Row[]>={
   ...Object.fromEntries(fieldSourceGroups.map(g=>['crest.'+g,field.rows[g]])),
   'crest.businesses':configuration.filter(r=>r.id===businessId),'crest.memberships':memberships,
   'crest_private.operations':[...operations.values()],'crest.jobs':input.commercial.bookings.rows.jobs,
   'crest.job_encounters':input.commercial.bookings.rows.job_encounters,'crest.allocation_plan_parts':input.commercial.bookings.rows.allocation_plan_parts,'crest.vehicles':crmRows.vehicles!,
  };
  for(const group of fieldSourceGroups)for(const fk of fieldSourceSchema[group].foreignKeys){const target=parents[fk.target];check(target);
   const keys=new Set(target.map(row=>JSON.stringify(fk.targetColumns.map(k=>row[k]))));for(const row of field.rows[group]){const key=fk.columns.map(k=>row[k]);if(key.every(v=>v!==null))check(keys.has(JSON.stringify(key)));}
  }
  function current(kind:string,id:unknown){check(customerUuid(id));const row=crmRows[kind]?.find(r=>r.id===id);check(row);return row;}
  function historical(kind:string,id:unknown,snapshot?:unknown){current(kind,id);const found=audits.some(a=>a.entity_kind===kind&&a.entity_id===id&&delta(a).after!==null&&(snapshot===undefined||historyJsonEqual(delta(a).after,snapshot)));check(found);}
  for(const row of input.crm.addresses.rows)current('customers',row.customer_id);
  for(const row of input.crm.associations.rows){current('customers',row.customer_id);current('vehicles',row.vehicle_id);}
  function location(v:unknown,customerId:unknown){if(v===null)return;object(v);if(v.kind==='manual')return;check(v.kind==='customer_address');object(v.snapshot);check(v.snapshot.id===v.addressId&&v.snapshot.version===v.addressVersion&&v.snapshot.customer_id===customerId);historical('addresses',v.addressId,v.snapshot);}
  for(const j of input.commercial.bookings.rows.jobs){current('customers',j.customer_id);location(parseHistoryJson(String(j.work_location_snapshot)),j.customer_id);}
  for(const row of input.commercial.bookings.rows.job_vehicles){
   const vehicle=parseHistoryJson(String(row.vehicle_snapshot)),customer=parseHistoryJson(String(row.customer_snapshot));object(vehicle);object(customer);
   historical('vehicles',row.vehicle_id,vehicle);historical('customers',customer.id,customer);
   if(row.customer_vehicle_id!==null){current('customer_vehicles',row.customer_vehicle_id);check(audits.some(a=>a.entity_kind==='customer_vehicles'&&a.entity_id===row.customer_vehicle_id&&(()=>{const v=delta(a).after;return !!v&&typeof v==='object'&&!Array.isArray(v)&&(v as Row).customer_id===customer.id&&(v as Row).vehicle_id===vehicle.id;})()));}
   location(row.pickup_location_snapshot===null?null:parseHistoryJson(String(row.pickup_location_snapshot)),customer.id);location(row.return_location_snapshot===null?null:parseHistoryJson(String(row.return_location_snapshot)),customer.id);
  }
  for(const g of input.commercial.rows.agreements)current('customers',g.customer_id);
  for(const e of input.commercial.rows.entitlements)if(e.vehicle_id!==null)current('vehicles',e.vehicle_id);
  // Every field receipt binds the complete audit set, not merely one matching
  // row. Retained original IDs continue to bind after later work/corrections.
  for(const [id,op]of operations){
   if(!fieldKinds.includes(String(op.command_type)))continue;
   check(op.schema_version===1&&op.result_schema_version===1&&op.state==='committed'&&typeof op.result==='string');
   const stored=JSON.parse(op.result) as Row,support=String(op.command_type).startsWith('operations.support_trip.');
   if(support){check(exactCustomerObject(stored,['schemaVersion','request','receipt'])&&stored.schemaVersion===1);object(stored.request);object(stored.receipt);check(stored.request.commandType===op.command_type&&stored.request.schemaVersion===1&&stored.request.businessId===businessId&&stored.request.actorId===op.actor_id&&stored.request.recoveryEpoch===op.recovery_epoch);}
   const receipt=(support?stored.receipt:stored) as Row;check(receipt.schemaVersion===1&&receipt.commandType===op.command_type&&receipt.businessId===businessId&&receipt.actorId===op.actor_id&&receipt.operationId===id&&receipt.recoveryEpoch===op.recovery_epoch);actor(op.actor_id);
   const all=audits.filter(a=>a.operation_id===id);ids(receipt[op.command_type==='operations.job.interrupt'||op.command_type==='operations.job.cancel_unfulfilled'||String(op.command_type).startsWith('operations.support_trip.')?'sourceAuditIds':'auditIds'],all.map(a=>a.id));
   if(['operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled'].includes(String(op.command_type))){
    const events=input.commercial.bookings.rows.job_events.filter(e=>e.operation_id===id);check(events.length===1);const event=events[0]!;
    check(receipt.jobId===event.job_id&&receipt.jobVersion===event.sequence);const evidence=parseHistoryJson(String(event.evidence));object(evidence);object(evidence.request);check(evidence.request.commandType===op.command_type&&evidence.request.businessId===businessId&&evidence.request.actorId===op.actor_id&&evidence.request.recoveryEpoch===op.recovery_epoch&&evidence.request.jobId===event.job_id);
    const job=chains.get('jobs:'+event.job_id)?.find(a=>a.operation_id===id);check(job&&job.entity_version===event.sequence);
   }
   if(op.command_type==='operations.job.complete'){
    ids(receipt.allocationPlanIds,input.commercial.bookings.rows.allocation_plan_versions.filter(p=>p.operation_id===id).map(p=>p.id));ids(receipt.outcomeIds,field.rows.work_scope_outcomes.filter(o=>o.operation_id===id).map(o=>o.id));ids(receipt.finalizationTaskIds,field.rows.job_finalization_tasks.filter(t=>t.operation_id===id).map(t=>t.id));
    const reviews=field.rows.review_requests.filter(r=>r.operation_id===id),messages=field.rows.messages.filter(m=>m.operation_id===id);check(reviews.length===1&&reviews[0]!.id===receipt.reviewRequestId&&messages.length<=1&&(messages[0]?.id??null)===receipt.messageId);
   }else if(op.command_type==='operations.job.cancel_unfulfilled')ids(receipt.outcomeIds,field.rows.work_scope_outcomes.filter(o=>o.operation_id===id).map(o=>o.id));
   else if(op.command_type==='operations.mileage.record'){
    const evidence=field.rows.mileage_evidence.find(e=>e.id===receipt.evidenceId);check(evidence&&evidence.operation_id===id&&evidence.leg_id===receipt.legId&&evidence.leg_version_id===receipt.legVersionId&&evidence.sequence===receipt.evidenceSequence&&evidence.source===receipt.source&&evidence.actual_miles===receipt.actualMiles&&evidence.estimate_miles===receipt.estimateMiles&&evidence.allocation_state===receipt.allocationState);ids(receipt.allocationIds,field.rows.leg_job_allocations.filter(a=>a.evidence_id===receipt.evidenceId).map(a=>a.id));
   }else if(String(op.command_type).startsWith('operations.support_trip.')){
    const leg=field.rows.travel_legs.find(l=>l.id===receipt.legVersionId);check(leg&&leg.operation_id===id&&leg.logical_id===receipt.legId&&leg.sequence===receipt.legSequence&&leg.state===receipt.legState&&input.commercial.bookings.rows.operator_controls.some(c=>c.id===receipt.operatorControlId&&c.operator_actor_id===op.actor_id));
    object(stored.request);check(stored.request.legId===leg.logical_id&&stored.request.expectedLegVersionId===leg.replaces_id);
    const original=parseHistoryJson(op.result);object(original);object(original.receipt);const image=parseHistoryJson(JSON.stringify(leg));object(image);
    for(const [key,spec]of Object.entries(fieldSourceSchema.travel_legs.fields))if(spec.type==='jsonb'&&leg[key]!==null)image[key]=parseHistoryJson(String(leg[key]));
    check(historyJsonEqual(original.receipt.leg,image));
   }
   usedOperations.add(id);
  }
  // Preserve strict existing initial/v2 booking and mode receipt parsers.
  for(const [id,op]of operations)if(['operations.job.book','operations.job.cancel','operations.job.reschedule','operations.fulfillment_modes.initialize','operations.fulfillment_modes.save'].includes(String(op.command_type))){
   check(usedOperations.has(id)&&typeof op.result==='string');const wire={state:'committed',operationId:id,recoveryEpoch:op.recovery_epoch,receipt:JSON.parse(op.result)},all=audits.filter(a=>a.operation_id===id);
   if(String(op.command_type).startsWith('operations.fulfillment_modes.')){const r=parseFulfillmentModeCommitted(wire,businessId,id).receipt;check(all.length===1&&all[0]!.id===r.auditEventId);}
   else{const r=(op.command_type==='operations.job.reschedule'?parseRescheduledJobCommitted:op.command_type==='operations.job.book'?op.schema_version===2?parseAmendedBookedJobCommitted:parseBookedJobCommitted:op.schema_version===2?parseAmendedCancelledJobCommitted:parseCancelledJobCommitted)(wire,businessId,id).receipt;ids(r.sourceAuditIds,all.map(a=>a.id));check(chains.get('jobs:'+r.jobId)?.some(a=>a.id===r.jobAuditEventId&&a.operation_id===id&&a.entity_version===r.version));}
  }
  const files=new Map<string,string>();let total=0;
  const add=(name:string,content:string)=>{check(/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/.test(name)&&typeof content==='string'&&Buffer.byteLength(content)<=8*1024*1024);const prior=files.get(name);if(prior!==undefined){check(prior===content);return;}total+=Buffer.byteLength(content);check(total<=64*1024*1024);files.set(name,content);};
  const base=formatBusinessFoundationBundle(input,{businessId}).forServer();for(const part of base.parts)add(part.name,part.content);add('foundation_manifest.json',base.manifest);
  for(const [group,formatted]of Object.entries(formattedCrm)){const manifest=JSON.parse(formatted.manifest) as {parts:{name:string;bytes:number;sha256:string}[]};const values=[formatted.csv,formatted.escapeMap,formatted.dictionary];check(manifest.parts.length===3);for(const [i,part]of manifest.parts.entries()){const content=values[i]!;check(part.bytes===Buffer.byteLength(content)&&part.sha256===sha(content));add(part.name,content);}add('crm_'+group+'_manifest.json',formatted.manifest);}
  for(const [name,content]of Object.entries(commercial.files))add(name,content);add('quote_amendment_manifest.json',commercial.manifest);
  const quoteNames={familiesCsv:'quote_families.csv',revisionsCsv:'quote_revisions.csv',itemsCsv:'quote_items.csv',assessmentsCsv:'condition_assessments.csv',approvalsCsv:'quote_approvals.csv',escapeMap:'quote_review_escape_map.json',dictionary:'quote_review_dictionary.json',manifest:'quote_review_manifest.json'};
  for(const key of Object.keys(quoteNames) as (keyof typeof quoteNames)[])add(quoteNames[key],commercial.quoteFiles[key]);
  check(commercial.bookingFiles&&commercial.fieldFiles);
  for(const [group,parts]of Object.entries(commercial.bookingFiles.tables)){add(group+'.csv',parts.csv);add(group+'_escape_map.json',parts.escapeMap);add(group+'_dictionary.json',parts.dictionary);}
  add('booking_source_references.json',commercial.bookingFiles.references);add('booking_source_manifest.json',commercial.bookingFiles.manifest);
  for(const [name,content]of Object.entries(commercial.fieldFiles.files))add(name,content);add('field_source_manifest.json',commercial.fieldFiles.manifest);
  const manifest=JSON.stringify({formatVersion:1,profile:'crest.field-workspace-sources.v1',businessId,generationId:foundation.generationId,historySnapshotToken:foundation.history.context.snapshotToken,includedBookingHistoryVerified:true,includedCrmCurrentAndHistoricalReferencesVerified:true,includedFieldForeignKeysVerified:true,includedActorAndMembershipReferencesVerified:true,includedFieldReceiptAuditSetsVerified:true,bookingAuditCount:usedAudits.size,parts:[...files].map(([name,content])=>({name,bytes:Buffer.byteLength(content),sha256:sha(content)})),assurance:'supplied_source_consistency_only',consistentCaptureProven:false,referenceClosureComplete:false,completePortableExport:false,completeBackup:false})+'\n';
  check(files.size<=1024&&total+Buffer.byteLength(manifest)<=64*1024*1024);
  return Object.freeze({manifest,parts:Object.freeze([...files].map(([name,content])=>Object.freeze({name,content})))});
 }catch(error){if(error instanceof FieldWorkspaceSourceError)throw error;throw new FieldWorkspaceSourceError();}
}
