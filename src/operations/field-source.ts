// Private included-domain sources. Capture authority, external parent closure,
// complete business portability and a recoverable backup remain separate gates.
import {createHash} from 'node:crypto';
import {customerUuid as uuid,customerInstant as instant,customerVersion as version} from '../customer/customer-contract.ts';
import {fieldSourceGroups,fieldSourceSchema} from './field-source-schema.ts';
import type {FieldSourceGroup} from './field-source-schema.ts';
import {recordedOperatorOccupancy} from './work-occupancy.ts';
import {prepareMileageBody} from './mileage.ts';
import {workBoundaryKind} from './job-work-boundary-contract.ts';
import {workStartKind} from './job-work-start-contract.ts';
import {workEndKind} from './job-work-end-contract.ts';
import {mobileDepartureKind} from './mobile-departure-contract.ts';
import {parsePickupTripSave,pickupTripKind} from './pickup-trip-contract.ts';
import {verifyBusinessHistoryEvidence} from '../security/business-history-evidence.ts';
import {formatBusinessHistoryCsv} from '../security/business-history-csv.ts';
import {parseHistoryJson,historyJsonEqual,historyJsonNumber,historyJsonBigint} from '../security/history-evidence-json.ts';
type Row=Readonly<Record<string,string|boolean|null>>;
const reviewOutcomeKind='operations.message.record_outcome';
type Context=Readonly<{schemaVersion:1;profile:'crest.field-sources.v1';businessId:string;snapshotToken:string;historySnapshotToken:string;observedAt:string;expectedCounts:Readonly<Record<FieldSourceGroup,string>>}>;
export type FieldSourceInput=Readonly<{context:Context;rows:Readonly<Record<FieldSourceGroup,readonly Row[]>>;historyEvidence:string}>;
export class FieldSourceError extends Error{constructor(){super('FIELD_SOURCE_REVIEW_REQUIRED');this.name='FieldSourceError';}}
const hash=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex'),quote=(v:string)=>'"'+v.replaceAll('"','""')+'"';
function check(v:unknown):asserts v{if(!v)throw new FieldSourceError();}
function object(v:unknown):asserts v is Record<string,unknown>{check(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));}
function shape(v:unknown,keys:readonly string[]):asserts v is Record<string,unknown>{object(v);const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>d[k]?.enumerable&&Object.hasOwn(d[k]!,'value')));}
function text(v:unknown):v is string{return typeof v==='string'&&!v.includes('\0')&&Buffer.from(v).toString('utf8')===v;}
function parseRow(group:FieldSourceGroup,value:unknown,business:string):Row{
 const fields=fieldSourceSchema[group].fields;shape(value,Object.keys(fields));check(value.business_id===business);
 for(const [key,spec]of Object.entries(fields)){
  const v=value[key];if(v===null){check(spec.nullable);continue;}
  if(spec.type==='boolean'){check(typeof v==='boolean');continue;}check(text(v));
  if(spec.type==='uuid')check(uuid(v));
  else if(spec.type==='bigint')check(/^-?(0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)>=-9223372036854775808n&&BigInt(v)<=9223372036854775807n);
  else if(spec.type==='timestamp with time zone')check(instant(v));
  else if(spec.type==='jsonb')object(parseHistoryJson(v));
  else if(spec.type.startsWith('numeric')){const [precision,scale]=spec.type.match(/[0-9]+/g)!.map(Number);check(new RegExp('^-?(0|[1-9][0-9]{0,'+(precision!-scale!-1)+'})\\.[0-9]{'+scale+'}$').test(v));}
 }
 check(value.origin==='manual'&&uuid(value.id)&&instant(value.created_at));return Object.freeze({...value}) as Row;
}
function sourceImage(group:FieldSourceGroup,row:Row,image:unknown){
 shape(image,Object.keys(fieldSourceSchema[group].fields));
 for(const [key,spec]of Object.entries(fieldSourceSchema[group].fields)){
  const v=row[key];if(spec.type==='jsonb'&&v!==null)check(typeof v==='string'&&historyJsonEqual(parseHistoryJson(v),image[key]));
  else if((spec.type==='bigint'||spec.type.startsWith('numeric'))&&v!==null&&typeof image[key]!=='string')check(typeof v==='string'&&historyJsonEqual(parseHistoryJson(v),image[key]));
  else check(historyJsonEqual(parseHistoryJson(JSON.stringify(v)),image[key]));
 }
}
function verifyPickupTripSource(operation:Record<string,unknown>,rows:readonly Row[],versions:ReadonlyMap<string,Row>,
 operations:ReadonlyMap<string,Record<string,unknown>>,auditIds:readonly unknown[]){
 check(rows.length===1&&auditIds.length===1&&typeof operation.result==='string'&&historyJsonNumber(operation.schema_version,1)&&historyJsonNumber(operation.result_schema_version,1));
 const stored=parseHistoryJson(operation.result),wire=JSON.parse(operation.result);
 shape(stored,['schemaVersion','request','receipt']);check(historyJsonNumber(stored.schemaVersion,1));
 shape(stored.request,['schemaVersion','commandType','businessId','actorId','recoveryEpoch','jobId','jobVersion','legId','expectedLegVersionId','body']);
 shape(stored.receipt,['leg','jobVehicleIds','auditId','departure']);
 const row=rows[0]!,request=wire.request;
 const checked=parsePickupTripSave({schemaVersion:request.schemaVersion,businessId:request.businessId,operationId:operation.operation_id,
  recoveryEpoch:request.recoveryEpoch,jobId:request.jobId,expectedJobVersion:request.jobVersion,legId:request.legId,
  expectedLegVersionId:request.expectedLegVersionId,body:request.body});
 check(request.commandType===pickupTripKind&&request.businessId===row.business_id&&request.actorId===row.created_by&&
  request.actorId===row.operator_actor_id&&request.recoveryEpoch===operation.recovery_epoch&&request.jobId===row.job_context_id&&
  request.legId===row.logical_id&&request.expectedLegVersionId===row.replaces_id&&checked.body.action===row.change_kind&&
  checked.body.reason===row.reason&&stored.receipt.auditId===auditIds[0]);
 sourceImage('travel_legs',row,stored.receipt.leg);
 const departure=versions.get(checked.legId);
 check(departure&&departure.sequence==='1'&&departure.job_context_id===row.job_context_id&&departure.purpose===row.purpose&&
  departure.operator_actor_id===row.operator_actor_id&&typeof departure.operation_id==='string');
 const startOperation=operations.get(departure.operation_id);
 check(startOperation?.command_type===pickupTripKind&&typeof startOperation.result==='string');
 const start=parseHistoryJson(startOperation.result);
 object(start);object(start.request);object(start.request.body);object(start.request.body.trip);
 check(historyJsonEqual(stored.receipt.departure,start.request.body)&&
  historyJsonEqual(stored.receipt.jobVehicleIds,start.request.body.trip.jobVehicleIds));
 const body=checked.body;
 if(body.action==='depart'){
  check(row.purpose===(body.trip.purpose??'pickup')&&row.id===row.logical_id&&row.sequence==='1'&&row.state==='open'&&row.driven_vehicle_id===body.trip.drivenVehicleId&&
   typeof row.origin_snapshot==='string'&&historyJsonEqual(parseHistoryJson(row.origin_snapshot),parseHistoryJson(JSON.stringify(body.trip.origin)))&&
   row.eta_at===body.trip.etaAt&&row.eta_source===(body.trip.etaAt===null?null:'owner_entered')&&
   row.eta_calculated_at===(body.trip.etaAt===null?null:row.departed_at)&&row.notes===body.trip.notes);
 }else{
  check(row.sequence==='2'&&row.replaces_id===departure.id&&
   ['driven_vehicle_id','origin_snapshot','departed_at','eta_at','eta_source','eta_calculated_at','notes'].every(key=>row[key]===departure[key])&&
   (body.action==='arrive'?row.state==='closed'&&row.destination_snapshot===departure.destination_snapshot:
    row.state==='cancelled'&&typeof row.destination_snapshot==='string'&&
    historyJsonEqual(parseHistoryJson(row.destination_snapshot),parseHistoryJson(JSON.stringify(body.trip.actualStop)))));
 }
}
function verifyWorkBoundarySource(operation:Record<string,unknown>,rows:readonly Row[],versions:ReadonlyMap<string,Row>,auditIds:readonly string[]){
 check(historyJsonNumber(operation.schema_version,1)&&historyJsonNumber(operation.result_schema_version,1)&&
  operation.origin==='manual'&&operation.import_row_id===null&&typeof operation.result==='string'&&rows.length===2&&auditIds.length===2);
 const stored=parseHistoryJson(operation.result);
 shape(stored,['schemaVersion','request','receipt']);
 check(historyJsonNumber(stored.schemaVersion,1));
 const {request,receipt}=stored;
 const binding=['schemaVersion','commandType','businessId','actorId','operationId','recoveryEpoch','jobId','expectedJobVersion','correctedAt','reason'];
 shape(request,[...binding,'leftVersionId','rightVersionId']);
 shape(receipt,[...binding,'previousBoundaryAt','left','right','auditIds']);
 check(historyJsonNumber(request.schemaVersion,1)&&request.commandType===workBoundaryKind&&
  request.businessId===operation.business_id&&request.actorId===operation.actor_id&&
  request.operationId===operation.operation_id&&request.recoveryEpoch===operation.recovery_epoch&&uuid(request.jobId)&&
  version(request.expectedJobVersion)&&uuid(request.leftVersionId)&&uuid(request.rightVersionId)&&request.leftVersionId!==request.rightVersionId&&
  instant(request.correctedAt)&&typeof request.reason==='string'&&request.reason.trim().length>0&&[...request.reason].length<=1000&&
  binding.every(key=>historyJsonEqual(request[key],receipt[key]))&&
  Array.isArray(receipt.auditIds)&&receipt.auditIds.length===2&&new Set(receipt.auditIds).size===2&&
  auditIds.every(id=>Array.isArray(receipt.auditIds)&&receipt.auditIds.includes(id)));
 const left=rows.find(row=>row.replaces_id===request.leftVersionId),right=rows.find(row=>row.replaces_id===request.rightVersionId);
 const originalLeft=versions.get(request.leftVersionId),originalRight=versions.get(request.rightVersionId);
 check(left&&right&&originalLeft&&originalRight&&left.job_id===request.jobId&&right.job_id===request.jobId&&
  originalLeft.job_id===request.jobId&&originalRight.job_id===request.jobId&&
  left.operator_actor_id===request.actorId&&right.operator_actor_id===request.actorId&&
  left.kind!==right.kind&&left.kind===originalLeft.kind&&right.kind===originalRight.kind&&
  left.pause_reason===originalLeft.pause_reason&&right.pause_reason===originalRight.pause_reason&&
  left.change_kind==='correct'&&right.change_kind==='correct'&&left.reason===request.reason&&right.reason===request.reason);
 const previous=originalLeft.ended_at,corrected=request.correctedAt;
 check(instant(previous)&&previous===originalRight.started_at&&receipt.previousBoundaryAt===previous&&previous!==corrected&&
  instant(originalLeft.started_at)&&corrected>originalLeft.started_at&&
  (originalRight.ended_at===null||instant(originalRight.ended_at)&&corrected<originalRight.ended_at)&&
  left.started_at===originalLeft.started_at&&right.ended_at===originalRight.ended_at&&
  left.ended_at===corrected&&right.started_at===corrected);
 sourceImage('work_intervals',left,receipt.left);
 sourceImage('work_intervals',right,receipt.right);
}
function unchanged(before:Record<string,unknown>,after:Record<string,unknown>,changed:readonly string[]){
 const retained=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>!changed.includes(key)));
 return historyJsonEqual(retained(before),retained(after));
}
function auditImages(audit:Record<string,unknown>){
 check(typeof audit.delta==='string');
 const delta=parseHistoryJson(audit.delta);
 shape(delta,['schemaVersion','before','after']);check(historyJsonNumber(delta.schemaVersion,1));
 return delta;
}
function verifyWorkStartSource(operation:Record<string,unknown>,rows:readonly Row[],maps:Record<FieldSourceGroup,Map<unknown,Row>>,
 audits:readonly Record<string,unknown>[],events:ReadonlyMap<unknown,Record<string,unknown>>){
 check(historyJsonNumber(operation.schema_version,1)&&historyJsonNumber(operation.result_schema_version,1)&&
  operation.origin==='manual'&&operation.import_row_id===null&&typeof operation.result==='string');
 const stored=parseHistoryJson(operation.result);
 shape(stored,['schemaVersion','request','receipt']);check(historyJsonNumber(stored.schemaVersion,1));
 const {request,receipt}=stored;
 const binding=['schemaVersion','commandType','businessId','actorId','operationId','recoveryEpoch','jobId','initialEventId','correctedAt','reason'];
 shape(request,[...binding,'expectedJobVersion','workVersionId','arrivalVersionId']);
 shape(receipt,[...binding,'jobVersion','state','eventId','previousStartedAt','work','arrival','auditIds']);
 check(historyJsonNumber(request.schemaVersion,1)&&request.commandType===workStartKind&&
  request.businessId===operation.business_id&&request.actorId===operation.actor_id&&request.operationId===operation.operation_id&&
  request.recoveryEpoch===operation.recovery_epoch&&uuid(request.jobId)&&uuid(request.initialEventId)&&uuid(receipt.eventId)&&
  version(request.expectedJobVersion)&&version(receipt.jobVersion)&&BigInt(receipt.jobVersion)===BigInt(request.expectedJobVersion)+1n&&
  uuid(request.workVersionId)&&(request.arrivalVersionId===null||uuid(request.arrivalVersionId))&&
  instant(request.correctedAt)&&typeof request.reason==='string'&&request.reason.trim().length>0&&[...request.reason].length<=1000&&
  binding.every(key=>historyJsonEqual(request[key],receipt[key])));
 const linked=request.arrivalVersionId!==null;
 check(rows.length===(linked?2:1)&&audits.length===(linked?4:3)&&Array.isArray(receipt.auditIds)&&
  receipt.auditIds.length===audits.length&&new Set(receipt.auditIds).size===audits.length&&
  audits.every(a=>a.actor_id===request.actorId&&a.created_by===request.actorId&&receipt.auditIds instanceof Array&&receipt.auditIds.includes(a.id)));
 const originalAudit=events.get(request.initialEventId),eventAudit=events.get(receipt.eventId),jobAudit=audits.find(a=>a.entity_kind==='jobs');
 check(originalAudit&&originalAudit.action==='create'&&eventAudit&&audits.includes(eventAudit)&&eventAudit.action==='create'&&
  jobAudit&&jobAudit.entity_id===request.jobId&&jobAudit.entity_version===receipt.jobVersion&&jobAudit.action==='revise');
 const {after:initialEvent}=auditImages(originalAudit),{before:eventBefore,after:event}=auditImages(eventAudit);
 const {before,after}=auditImages(jobAudit);
 object(initialEvent);object(event);object(before);object(after);object(initialEvent.evidence);
 check(eventBefore===null&&initialEvent.id===request.initialEventId&&initialEvent.job_id===request.jobId&&initialEvent.created_by===request.actorId&&
  initialEvent.to_state==='in_progress'&&initialEvent.from_state===(linked?'en_route':'scheduled')&&
  initialEvent.evidence.action===(linked?'arrive':'direct_arrive')&&initialEvent.evidence.travelOmissionRecorded===!linked&&
  event.id===receipt.eventId&&event.job_id===request.jobId&&event.operation_id===request.operationId&&event.created_by===request.actorId&&
  event.sequence===receipt.jobVersion&&event.from_state===receipt.state&&event.to_state===receipt.state&&
  event.effective_at===request.correctedAt&&event.reason===request.reason&&instant(event.created_at)&&request.correctedAt<=event.created_at&&
  before.id===request.jobId&&before.version===request.expectedJobVersion&&before.state===receipt.state&&before.fulfillment_mode==='mobile'&&
  before.operator_actor_id===request.actorId&&before.first_work_at===receipt.previousStartedAt&&
  after.first_work_at===request.correctedAt&&after.version===receipt.jobVersion&&after.operation_id===request.operationId&&after.updated_by===request.actorId&&
  unchanged(before,after,['first_work_at','version','operation_id','updated_at','updated_by']));
 const work=rows.find(row=>row.replaces_id===request.workVersionId),priorWork=maps.work_intervals.get(request.workVersionId),
  initialWork=maps.work_intervals.get(initialEvent.evidence.workIntervalId);
 check(work&&priorWork&&initialWork&&initialWork.change_kind==='open'&&initialWork.operation_id===initialEvent.operation_id&&
  initialWork.started_at===initialEvent.effective_at&&work.logical_id===initialWork.id&&work.job_id===request.jobId&&work.kind==='active'&&
  work.operator_actor_id===request.actorId&&work.started_at===request.correctedAt&&priorWork.started_at===receipt.previousStartedAt&&
  work.started_at!==priorWork.started_at&&work.change_kind==='correct'&&work.reason===request.reason&&
  unchanged(priorWork,work,['id','sequence','replaces_id','started_at','change_kind','reason','created_at','operation_id']));
 sourceImage('work_intervals',work,receipt.work);
 let linkedVersion:unknown=null;
 if(linked){
  const trip=rows.find(row=>row.replaces_id===request.arrivalVersionId),priorTrip=maps.travel_legs.get(request.arrivalVersionId),
   initialTrip=maps.travel_legs.get(initialEvent.evidence.travelLegId);
  check(trip&&priorTrip&&initialTrip&&initialTrip.change_kind==='arrive'&&initialTrip.operation_id===initialEvent.operation_id&&
   initialTrip.arrived_at===initialEvent.effective_at&&trip.logical_id===initialTrip.logical_id&&trip.job_context_id===request.jobId&&
   trip.operator_actor_id===request.actorId&&trip.purpose==='mobile_work_site'&&trip.state==='closed'&&
   priorTrip.arrived_at===receipt.previousStartedAt&&trip.arrived_at===request.correctedAt&&trip.change_kind==='correct'&&trip.reason===request.reason&&
   unchanged(priorTrip,trip,['id','sequence','replaces_id','arrived_at','change_kind','reason','created_at','operation_id']));
  sourceImage('travel_legs',trip,receipt.arrival);linkedVersion=trip.id;
 }else check(initialEvent.evidence.travelLegId===null&&receipt.arrival===null);
 check(historyJsonEqual(event.evidence,parseHistoryJson(JSON.stringify({schemaVersion:1,action:'correct_first_start',
  initialEventId:request.initialEventId,workVersionId:work.id,arrivalVersionId:linkedVersion}))));
}
function verifyWorkEndSource(operation:Record<string,unknown>,rows:readonly Row[],work:ReadonlyMap<unknown,Row>,
 audits:readonly Record<string,unknown>[],events:ReadonlyMap<unknown,Record<string,unknown>>){
 check(historyJsonNumber(operation.schema_version,1)&&historyJsonNumber(operation.result_schema_version,1)&&
  operation.origin==='manual'&&operation.import_row_id===null&&typeof operation.result==='string'&&rows.length===1&&audits.length===3);
 const stored=parseHistoryJson(operation.result);
 shape(stored,['schemaVersion','request','receipt']);check(historyJsonNumber(stored.schemaVersion,1));
 const {request,receipt}=stored;
 const binding=['schemaVersion','commandType','businessId','actorId','operationId','recoveryEpoch','jobId','completionEventId','correctedAt','reason'];
 shape(request,[...binding,'expectedJobVersion','workVersionId']);
 shape(receipt,[...binding,'jobVersion','eventId','completionOutcome','previousCompletedAt','work','auditIds']);
 check(historyJsonNumber(request.schemaVersion,1)&&request.commandType===workEndKind&&
  request.businessId===operation.business_id&&request.actorId===operation.actor_id&&request.operationId===operation.operation_id&&
  request.recoveryEpoch===operation.recovery_epoch&&uuid(request.jobId)&&uuid(request.completionEventId)&&uuid(request.workVersionId)&&
  uuid(receipt.eventId)&&version(request.expectedJobVersion)&&version(receipt.jobVersion)&&
  BigInt(receipt.jobVersion)===BigInt(request.expectedJobVersion)+1n&&
  instant(request.correctedAt)&&typeof request.reason==='string'&&request.reason.trim().length>0&&[...request.reason].length<=1000&&
  (receipt.completionOutcome==='full'||receipt.completionOutcome==='partial')&&
  binding.every(key=>historyJsonEqual(request[key],receipt[key])));
 check(Array.isArray(receipt.auditIds)&&receipt.auditIds.length===3&&new Set(receipt.auditIds).size===3&&
  audits.every(a=>a.actor_id===request.actorId&&a.created_by===request.actorId&&receipt.auditIds instanceof Array&&receipt.auditIds.includes(a.id)));
 const completionAudit=events.get(request.completionEventId),eventAudit=events.get(receipt.eventId),jobAudit=audits.find(a=>a.entity_kind==='jobs');
 check(completionAudit&&completionAudit.action==='create'&&eventAudit&&audits.includes(eventAudit)&&eventAudit.action==='create'&&
  jobAudit&&jobAudit.entity_id===request.jobId&&jobAudit.entity_version===receipt.jobVersion&&jobAudit.action==='revise');
 const {before:completionBefore,after:completion}=auditImages(completionAudit),{before:eventBefore,after:event}=auditImages(eventAudit);
 const {before,after}=auditImages(jobAudit);
 object(completion);object(completion.evidence);object(event);object(before);object(after);
 check(completionBefore===null&&completion.id===request.completionEventId&&completion.job_id===request.jobId&&
  completion.created_by===request.actorId&&completion.to_state==='completed'&&
  (completion.from_state==='in_progress'||completion.from_state==='paused')&&completion.evidence.action==='complete'&&
  eventBefore===null&&event.id===receipt.eventId&&event.job_id===request.jobId&&event.operation_id===request.operationId&&
  event.created_by===request.actorId&&event.sequence===receipt.jobVersion&&event.from_state==='completed'&&event.to_state==='completed'&&
  event.effective_at===request.correctedAt&&event.reason===request.reason&&instant(event.created_at)&&request.correctedAt<=event.created_at&&
  before.id===request.jobId&&before.version===request.expectedJobVersion&&before.state==='completed'&&before.fulfillment_mode==='mobile'&&
  before.operator_actor_id===request.actorId&&before.completed_at===receipt.previousCompletedAt&&
  before.completion_outcome===receipt.completionOutcome&&instant(before.first_work_at)&&request.correctedAt>=before.first_work_at&&
  after.completed_at===request.correctedAt&&after.version===receipt.jobVersion&&after.operation_id===request.operationId&&after.updated_by===request.actorId&&
  unchanged(before,after,['completed_at','version','operation_id','updated_at','updated_by']));
 const saved=rows[0]!,prior=work.get(request.workVersionId),closed=work.get(completion.evidence.closedWorkIntervalId);
 check(prior&&closed&&closed.change_kind==='close'&&closed.operation_id===completion.operation_id&&
  closed.job_id===request.jobId&&closed.operator_actor_id===request.actorId&&closed.ended_at===completion.effective_at&&
  closed.kind===(completion.from_state==='paused'?'pause':'active')&&
  saved.replaces_id===prior.id&&saved.logical_id===closed.logical_id&&saved.job_id===request.jobId&&saved.operator_actor_id===request.actorId&&
  saved.kind===closed.kind&&prior.ended_at===receipt.previousCompletedAt&&prior.ended_at!==saved.ended_at&&
  instant(saved.started_at)&&request.correctedAt>=saved.started_at&&saved.ended_at===request.correctedAt&&
  saved.change_kind==='correct'&&saved.reason===request.reason&&
  unchanged(prior,saved,['id','sequence','replaces_id','ended_at','change_kind','reason','created_at','operation_id']));
 sourceImage('work_intervals',saved,receipt.work);
 check(historyJsonEqual(event.evidence,parseHistoryJson(JSON.stringify({schemaVersion:1,action:'correct_completion_time',
  completionEventId:request.completionEventId,workVersionId:saved.id}))));
}

function verifyMobileDepartureSource(operation:Record<string,unknown>,rows:readonly Row[],legs:ReadonlyMap<unknown,Row>,
 audits:readonly Record<string,unknown>[],events:ReadonlyMap<unknown,Record<string,unknown>>){
 check(historyJsonNumber(operation.schema_version,1)&&historyJsonNumber(operation.result_schema_version,1)&&
  operation.origin==='manual'&&operation.import_row_id===null&&typeof operation.result==='string'&&rows.length===1&&audits.length===1);
 const stored=parseHistoryJson(operation.result);
 shape(stored,['schemaVersion','request','receipt']);check(historyJsonNumber(stored.schemaVersion,1));
 const {request,receipt}=stored;
 const binding=['schemaVersion','commandType','businessId','actorId','operationId','recoveryEpoch','jobId','legId','departureEventId','correctedAt','reason'];
 shape(request,[...binding,'expectedJobVersion','legVersionId']);
 shape(receipt,[...binding,'jobVersion','previousDepartedAt','leg','mileageReviewRequired','auditIds']);
 check(historyJsonNumber(request.schemaVersion,1)&&request.commandType===mobileDepartureKind&&request.businessId===operation.business_id&&
  request.actorId===operation.actor_id&&request.operationId===operation.operation_id&&request.recoveryEpoch===operation.recovery_epoch&&
  uuid(request.jobId)&&uuid(request.legId)&&uuid(request.legVersionId)&&uuid(request.departureEventId)&&version(request.expectedJobVersion)&&
  receipt.jobVersion===request.expectedJobVersion&&receipt.mileageReviewRequired===true&&instant(request.correctedAt)&&
  typeof request.reason==='string'&&request.reason.trim().length>0&&[...request.reason].length<=1000&&
  binding.every(key=>historyJsonEqual(request[key],receipt[key])));
 const audit=audits[0]!,originAudit=events.get(request.departureEventId),saved=rows[0]!;
 check(originAudit&&originAudit.action==='create'&&Array.isArray(receipt.auditIds)&&receipt.auditIds.length===1&&receipt.auditIds[0]===audit.id&&
  audit.actor_id===request.actorId&&audit.created_by===request.actorId&&audit.entity_kind==='travel_legs'&&audit.entity_id===request.legId&&
  audit.entity_version===saved.sequence&&audit.action==='correct');
 const {before,after:departure}=auditImages(originAudit);
 object(departure);object(departure.evidence);
 const original=legs.get(request.legId),prior=legs.get(request.legVersionId);
 check(before===null&&departure.id===request.departureEventId&&departure.job_id===request.jobId&&departure.created_by===request.actorId&&
  departure.from_state==='scheduled'&&departure.to_state==='en_route'&&departure.evidence.action==='depart'&&
  departure.evidence.travelLegId===request.legId&&version(departure.sequence)&&BigInt(departure.sequence)<=BigInt(request.expectedJobVersion)&&
  original&&original.logical_id===request.legId&&original.sequence==='1'&&original.purpose==='mobile_work_site'&&
  original.job_context_id===request.jobId&&original.operator_actor_id===request.actorId&&original.change_kind==='depart'&&original.state==='open'&&
  original.operation_id===departure.operation_id&&original.departed_at===departure.effective_at&&
  prior&&prior.logical_id===original.logical_id&&saved.replaces_id===prior.id&&saved.logical_id===original.logical_id&&
  saved.operator_actor_id===request.actorId&&saved.job_context_id===request.jobId&&saved.purpose==='mobile_work_site'&&
  saved.departed_at===request.correctedAt&&saved.change_kind==='correct'&&saved.reason===request.reason&&
  prior.departed_at===receipt.previousDepartedAt&&prior.departed_at!==saved.departed_at&&instant(saved.created_at)&&
  request.correctedAt<=saved.created_at&&(saved.arrived_at===null||instant(saved.arrived_at)&&request.correctedAt<=saved.arrived_at)&&
  unchanged(prior,saved,['id','sequence','replaces_id','departed_at','change_kind','reason','created_at','operation_id']));
 sourceImage('travel_legs',saved,receipt.leg);
}

function verifyReviewOutcomes(
 events:ReadonlyMap<string,Row>,messages:ReadonlyMap<string,Row>,
 operations:ReadonlyMap<string,Record<string,unknown>>,audits:ReadonlyMap<string,readonly Record<string,unknown>[]>
){
 const outcomes=new Map<string,Row>();
 const roots=new Map<string,Row>();
 for(const event of events.values()){
  if(event.kind==='prepared'){
   check(uuid(event.message_id)&&!roots.has(event.message_id));
   roots.set(event.message_id,event);
  }else{
   check(uuid(event.operation_id)&&!outcomes.has(event.operation_id));
   outcomes.set(event.operation_id,event);
  }
 }
 const next=new Map<string,string>();
 for(const [id,operation] of operations){
  if(operation.command_type!==reviewOutcomeKind)continue;
  const event=outcomes.get(id),sourceAudits=audits.get(id);
  check(event&&sourceAudits?.length===1&&typeof operation.result==='string'&&
   historyJsonNumber(operation.schema_version,1)&&historyJsonNumber(operation.result_schema_version,1)&&
   operation.origin==='manual'&&operation.import_row_id===null);
  outcomes.delete(id);
  const stored=parseHistoryJson(operation.result);
  shape(stored,['schemaVersion','request','receipt']);
  check(historyJsonNumber(stored.schemaVersion,1));
  const {request,receipt}=stored;
  const identity=['schemaVersion','businessId','actorId','operationId','recoveryEpoch','jobId','messageId','priorEventId','kind'];
  shape(request,[...identity,'commandType','reason']);
  shape(receipt,[...identity,'eventId','effectiveAt','auditIds']);
  check(historyJsonNumber(request.schemaVersion,1)&&request.commandType===reviewOutcomeKind&&
   request.businessId===operation.business_id&&request.actorId===operation.actor_id&&request.operationId===id&&
   request.recoveryEpoch===operation.recovery_epoch&&request.kind===event.kind&&request.reason===event.reason&&
   uuid(request.priorEventId)&&uuid(request.messageId)&&uuid(event.id)&&
   receipt.eventId===event.id&&receipt.effectiveAt===event.effective_at&&event.effective_at===event.created_at&&
   ['opened','owner_confirmed_sent','failed','skipped'].includes(String(event.kind))&&
   (event.reason===null?event.kind!=='failed'&&event.kind!=='skipped':
    typeof event.reason==='string'&&event.reason.trim().length>0&&[...event.reason].length<=1000)&&
   identity.every(key=>historyJsonEqual(request[key],receipt[key])));
  const parent=events.get(request.priorEventId),message=messages.get(request.messageId),audit=sourceAudits[0]!;
  check(parent&&message&&message.purpose==='review_request'&&message.state==='prepared'&&
   message.job_id===request.jobId&&event.job_id===request.jobId&&event.message_id===message.id&&
   parent.job_id===event.job_id&&parent.message_id===event.message_id&&parent.kind!=='owner_confirmed_sent'&&
   parent.id!==event.id&&!next.has(request.priorEventId)&&
   audit.entity_kind==='message_events'&&audit.entity_id===event.id&&
   Array.isArray(receipt.auditIds)&&receipt.auditIds.length===1&&receipt.auditIds[0]===audit.id);
  const root=roots.get(request.messageId);
  check(root&&root.operation_id===message.operation_id&&root.job_id===message.job_id&&
   operations.get(String(root.operation_id))?.command_type==='operations.job.complete');
  next.set(request.priorEventId,event.id);
 }
 check(outcomes.size===0);
 let reached=0;
 for(const root of roots.values()){
  let following=next.get(String(root.id));
  while(following){
   reached++;
   check(reached<=next.size);
   following=next.get(following);
  }
 }
 check(reached===next.size);
}
export function verifyFieldSources(value:unknown){
 try{
  shape(value,['context','rows','historyEvidence']);const c=value.context;shape(c,['schemaVersion','profile','businessId','snapshotToken','historySnapshotToken','observedAt','expectedCounts']);
  check(c.schemaVersion===1&&c.profile==='crest.field-sources.v1'&&uuid(c.businessId)&&instant(c.observedAt)&&typeof c.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(c.snapshotToken)&&typeof c.historySnapshotToken==='string'&&/^[a-f0-9]{64}$/.test(c.historySnapshotToken));shape(c.expectedCounts,fieldSourceGroups);shape(value.rows,fieldSourceGroups);
  const rows={} as Record<FieldSourceGroup,readonly Row[]>;let count=0,bytes=0;
  for(const group of fieldSourceGroups){const raw=value.rows[group],expected=c.expectedCounts[group];check(version(expected,true)&&Array.isArray(raw)&&raw.length===Number(expected));count+=raw.length;check(count<=10000);const ids=new Set<string>();rows[group]=Object.freeze(raw.map(v=>{const row=parseRow(group,v,c.businessId as string);check(typeof row.id==='string'&&!ids.has(row.id));ids.add(row.id);bytes+=Buffer.byteLength(JSON.stringify(row));check(bytes<=32*1024*1024&&String(row.created_at)<=String(c.observedAt));return row;}).sort((a,b)=>String(a.id)<String(b.id)?-1:1));}
  const maps=Object.fromEntries(fieldSourceGroups.map(g=>[g,new Map(rows[g].map(r=>[r.id,r]))])) as Record<FieldSourceGroup,Map<string,Row>>;
  for(const group of fieldSourceGroups)for(const fk of fieldSourceSchema[group].foreignKeys){
   const target=fk.target.slice('crest.'.length) as FieldSourceGroup;if(!fieldSourceGroups.includes(target))continue;
   const keys=new Set(rows[target].map(r=>JSON.stringify(fk.targetColumns.map(k=>r[k]))));for(const row of rows[group]){const values=fk.columns.map(k=>row[k]);if(values.every(v=>v!==null))check(keys.has(JSON.stringify(values)));}
  }
  function current(group:'work_intervals'|'travel_legs'|'mileage_evidence'){
   const used=new Set<string>();for(const row of rows[group]){check(version(row.sequence)&&BigInt(row.sequence as string)>0n);if(row.replaces_id!==null){check(typeof row.replaces_id==='string'&&!used.has(row.replaces_id));used.add(row.replaces_id);const before=maps[group].get(row.replaces_id);check(before&&BigInt(before.sequence as string)+1n===BigInt(row.sequence as string)&&before.operator_actor_id===row.operator_actor_id&&(group==='mileage_evidence'?before.leg_id===row.leg_id:before.logical_id===row.logical_id));}else{check(row.sequence==='1');if(group!=='mileage_evidence')check(row.logical_id===row.id);}}
   return rows[group].filter(row=>!used.has(row.id as string));
  }
  const work=current('work_intervals'),legs=current('travel_legs');current('mileage_evidence');
  for(const row of rows.work_intervals)check(['active','pause'].includes(row.kind as string)&&(row.kind!=='pause'||typeof row.pause_reason==='string'&&row.pause_reason.trim().length>0)&&['open','record','close','correct'].includes(row.change_kind as string));
  for(const row of rows.travel_legs)check(['open','closed','cancelled'].includes(row.state as string)&&((row.state==='open')===(row.arrived_at===null)));
  const occupancy=recordedOperatorOccupancy(work.map(r=>({id:r.id,jobId:r.job_id,operatorId:r.operator_actor_id,kind:r.kind,startedAt:r.started_at,endedAt:r.ended_at})),legs.map(r=>({id:r.id,operatorId:r.operator_actor_id,departedAt:r.departed_at,arrivedAt:r.arrived_at})),c.observedAt);
  for(const e of rows.mileage_evidence){const parts=rows.leg_job_allocations.filter(a=>a.evidence_id===e.id);prepareMileageBody({source:e.source,movementKind:e.movement_kind,actualMiles:e.actual_miles,estimateMiles:e.estimate_miles,estimateSource:e.estimate_source,odometerStart:e.odometer_start,odometerEnd:e.odometer_end,notes:e.notes,reason:e.reason,allocationState:e.allocation_state,allocations:parts.map(a=>({jobId:a.job_id,fraction:a.fraction}))});check(e.actual_miles===null?e.confirmed_at===null&&e.confirmed_by===null:maps.travel_legs.get(e.leg_version_id as string)?.state!=='open'&&e.confirmed_at===e.created_at&&e.confirmed_by===e.created_by);}
  for(const r of rows.work_scope_outcomes)check(['completed','unfulfilled','cancelled'].includes(r.outcome as string)&&BigInt(r.completed_cents as string)>=0n&&(r.outcome==='completed'||r.completed_cents==='0'));
  const history=verifyBusinessHistoryEvidence(value.historyEvidence,{businessId:c.businessId});check(history.context.snapshotToken===c.historySnapshotToken);
  const operations=new Map<string,Record<string,unknown>>(),audits=new Map<string,Record<string,unknown>>();
  const boundaryAuditIds=new Map<string,string[]>(),boundaryRows=new Map<string,Row[]>();
  const endpointAudits=new Map<string,Record<string,unknown>[]>(),endpointRows=new Map<string,Row[]>(),jobEventAudits=new Map<unknown,Record<string,unknown>>();
  const messageOutcomeAudits=new Map<string,Record<string,unknown>[]>();
  for(const record of history.records){
   const body=parseHistoryJson(record.canonicalEvidence);object(body);object(body.row);
   const r=body.row,id=r.operation_id as string;
   if(record.kind==='operation'){operations.set(id,r);continue;}
   if(r.entity_kind==='job_events'){
    check(!jobEventAudits.has(r.entity_id));jobEventAudits.set(r.entity_id,r);
   }
   const command=operations.get(id)?.command_type;
   if(command===reviewOutcomeKind){
    const entries=messageOutcomeAudits.get(id)??[];entries.push(r);messageOutcomeAudits.set(id,entries);
   }
   if(command===workStartKind||command===workEndKind||command===mobileDepartureKind){
    const entries=endpointAudits.get(id)??[];entries.push(r);endpointAudits.set(id,entries);
   }
   if(command===workBoundaryKind){
    check(r.entity_kind==='work_intervals');
    const ids=boundaryAuditIds.get(id)??[];ids.push(record.recordId);boundaryAuditIds.set(id,ids);
   }
   if(fieldSourceGroups.includes(r.entity_kind as FieldSourceGroup)){
    const key=[r.entity_kind,r.entity_id,typeof r.entity_version==='string'?r.entity_version:historyJsonBigint(r.entity_version)?.toString()].join(':');
    check(!audits.has(key));audits.set(key,r);
   }
  }
  const pickupRows=new Map<string,Row[]>(),pickupAudits=new Map<string,unknown[]>();
  const used=new Set<string>();for(const group of fieldSourceGroups)for(const row of rows[group]){
   const logical=group==='work_intervals'||group==='travel_legs'?row.logical_id:group==='mileage_evidence'?row.leg_id:row.id,sequence=['work_intervals','travel_legs','mileage_evidence'].includes(group)?row.sequence:'1',key=[group,logical,sequence].join(':'),audit=audits.get(key),operation=operations.get(row.operation_id as string);check(audit&&operation&&!used.has(key));used.add(key);
   check(audit.operation_id===row.operation_id&&audit.actor_id===row.created_by&&audit.created_by===row.created_by&&operation.actor_id===row.created_by&&operation.state==='committed'&&audit.reason===(row.reason??null));const delta=parseHistoryJson(audit.delta as string);shape(delta,['schemaVersion','before','after']);check(historyJsonNumber(delta.schemaVersion,1));sourceImage(group,row,delta.after);
   const prior=['work_intervals','travel_legs','mileage_evidence'].includes(group)&&row.replaces_id!==null?maps[group].get(row.replaces_id as string):undefined;if(prior)sourceImage(group,prior,delta.before);else check(delta.before===null);
   const action=sequence==='1'?'create':group==='mileage_evidence'?'correct':row.change_kind;check(audit.action===action);
   if(operation.command_type===pickupTripKind||group==='travel_legs'&&(row.purpose==='pickup'||row.purpose==='to_work_site'||row.purpose==='return_to_customer')){
    check(operation.command_type===pickupTripKind&&group==='travel_legs'&&(row.purpose==='pickup'||row.purpose==='to_work_site'||row.purpose==='return_to_customer')&&typeof row.operation_id==='string');
    const travel=pickupRows.get(row.operation_id)??[];travel.push(row);pickupRows.set(row.operation_id,travel);
    const events=pickupAudits.get(row.operation_id)??[];events.push(audit.id);pickupAudits.set(row.operation_id,events);
   }
   if(operation.command_type===workBoundaryKind){
    check(group==='work_intervals'&&typeof row.operation_id==='string');
    const pair=boundaryRows.get(row.operation_id)??[];pair.push(row);boundaryRows.set(row.operation_id,pair);
   }
   if(operation.command_type===workStartKind||operation.command_type===workEndKind||operation.command_type===mobileDepartureKind){
    check((group==='work_intervals'||group==='travel_legs')&&typeof row.operation_id==='string');
    const entries=endpointRows.get(row.operation_id)??[];entries.push(row);endpointRows.set(row.operation_id,entries);
   }
  }check(used.size===audits.size);
  for(const [id,operation]of operations)if(operation.command_type===pickupTripKind){
   verifyPickupTripSource(operation,pickupRows.get(id)??[],maps.travel_legs,operations,pickupAudits.get(id)??[]);
  }
  for(const [id,operation] of operations)if(operation.command_type===workBoundaryKind){
   verifyWorkBoundarySource(operation,boundaryRows.get(id)??[],maps.work_intervals,boundaryAuditIds.get(id)??[]);
  }
  for(const [id,operation] of operations)if(operation.command_type===workStartKind){
   verifyWorkStartSource(operation,endpointRows.get(id)??[],maps,endpointAudits.get(id)??[],jobEventAudits);
  }
  for(const [id,operation] of operations)if(operation.command_type===workEndKind){
   verifyWorkEndSource(operation,endpointRows.get(id)??[],maps.work_intervals,endpointAudits.get(id)??[],jobEventAudits);
  }
  for(const [id,operation] of operations)if(operation.command_type===mobileDepartureKind){
   verifyMobileDepartureSource(operation,endpointRows.get(id)??[],maps.travel_legs,endpointAudits.get(id)??[],jobEventAudits);
  }
  verifyReviewOutcomes(maps.message_events,maps.messages,operations,messageOutcomeAudits);
  return Object.freeze({context:Object.freeze({...c,expectedCounts:Object.freeze({...c.expectedCounts})}) as Context,rows:Object.freeze(rows),history,occupancy});
 }catch(error){if(error instanceof FieldSourceError)throw error;throw new FieldSourceError();}
}
export function formatFieldSourceCsv(input:unknown){
 const verified=verifyFieldSources(input),source=input as FieldSourceInput,{context:c,rows}=verified,files:Record<string,string>={},escapes:{entity:string;row_id:string;column:string;apostrophe_prefix:true}[]=[];
 for(const group of fieldSourceGroups){const columns=Object.keys(fieldSourceSchema[group].fields),lines=[columns.map(quote).join(',')];for(const row of rows[group])lines.push(columns.map(column=>{const original=row[column];if(original===null)return quote('\\N');let v=String(original).replaceAll('\\','\\\\');if(v.startsWith("'")||['=','+','-','@'].includes(v.trimStart()[0]??'')){v="'"+v;escapes.push({entity:group,row_id:row.id as string,column,apostrophe_prefix:true});}return quote(v);}).join(','));files[group+'.csv']=lines.join('\r\n')+'\r\n';}
 const history=formatBusinessHistoryCsv(source.historyEvidence,{businessId:c.businessId});for(const [entity,parts]of [['operations',history.operations],['audit_events',history.audits]] as const)for(const [kind,content]of Object.entries(parts))files[entity+(kind==='csv'?'.csv':kind==='escapeMap'?'_escape_map.json':'_dictionary.json')]=content;
 files['field_source_snapshot.json']=JSON.stringify({context:c,rows,historyEvidence:source.historyEvidence})+'\n';
 files['field_source_escape_map.json']=JSON.stringify({schemaVersion:1,businessId:c.businessId,snapshotToken:c.snapshotToken,escapes})+'\n';
 files['field_source_dictionary.json']=JSON.stringify({schemaVersion:1,profile:c.profile,tables:fieldSourceSchema,null:'\\N',csv:'UTF-8 RFC4180 CRLF; all cells quoted',numeric:'Signed64 integers and exact fixed-scale decimals remain strings; booleans decode according to the dictionary. Never pass distances or fractions through Number.',json:'JSONB columns retain original SQL JSON text; parse only losslessly. SQL NULL differs from the JSON text null.',decode:'Parse CSV. Test unescaped \\N for SQL NULL; remove exactly one mapped apostrophe; unescape paired backslashes. Retain JSON text and timestamps unchanged.',occupancy:'Derived only; rebuild from current work/travel versions. Pauses retain sessions but do not occupy labor. Physical travel is never labor or an inferred return.',externalDependencies:'Referenced jobs/appointments/accepted scope/CRM/actor/configuration and other domains remain external. This is not a complete Crest export, accounting report or backup.',noFinancialPosting:true})+'\n';
 for(const content of Object.values(files))check(Buffer.byteLength(content)<=8*1024*1024);check(Object.values(files).reduce((n,s)=>n+Buffer.byteLength(s),0)<=64*1024*1024);
 const manifest=JSON.stringify({schemaVersion:1,profile:c.profile,businessId:c.businessId,snapshotToken:c.snapshotToken,historySnapshotToken:c.historySnapshotToken,observedAt:c.observedAt,recordCounts:c.expectedCounts,sourceAuditClosureChecked:true,internalPhysicalReferencesChecked:true,externalReferenceClosureComplete:false,completePortableExport:false,completeBackup:false,parts:Object.entries(files).map(([name,content])=>({name,bytes:Buffer.byteLength(content),sha256:hash(content)}))})+'\n';return Object.freeze({verified,files:Object.freeze(files),manifest});
}
