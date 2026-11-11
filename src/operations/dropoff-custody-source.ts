import {createHash} from 'node:crypto';
import {customerUuid as uuid,customerVersion as version,customerInstant as instant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {verifyBusinessHistoryEvidence} from '../security/business-history-evidence.ts';
import {parseHistoryJson,historyJsonEqual,historyJsonNumber} from '../security/history-evidence-json.ts';
import {dropoffPolicyRevisionKind,parseDropoffCustodySave,parseDropoffPolicyRevision,
 parseDropoffPolicyRevisionCommitted,parseDropoffPolicySave} from './dropoff-custody-contract.ts';
import {parseFulfillmentModeVersion} from './fulfillment-mode-contract.ts';
import {imageValidationVersion,heicValidationVersion} from '../files/validation-contract.ts';

const columns={
 custody_authorization_configs:['id','business_id','mode_version_id','acknowledgement_text','condition_photo_required'],
 custody_cases:['id','business_id','job_id','job_vehicle_id','vehicle_id','mode','version','state','current_event_id','authorization_config_id'],
 custody_events:['id','business_id','case_id','version','prior_version','action','effective_at','recorded_at','person_snapshot','location_snapshot','notes','missing_photo_reason','created_by','operation_id','origin','acknowledgement_confirmed','condition_photo_id'],
 custody_photo_attempts:['id','business_id','job_id','job_vehicle_id','vehicle_id','case_id','handoff_version','actor_id','recovery_epoch','dispatch_id','declared_type','byte_size','reserved_at'],
 custody_photo_originals:['business_id','photo_id','detected_type','byte_size','sha256','validation_version','width','height','display_width','display_height','bit_depth','preview_sha256','preview_byte_size','preview_width','preview_height','verified_at']
} as const;
export const custodySourceGroups=Object.freeze(Object.keys(columns) as (keyof typeof columns)[]);
type Group=typeof custodySourceGroups[number];
type Row=Readonly<Record<string,string|number|boolean|null>>;
export type CustodySourceInput=Readonly<{context:unknown;rows:unknown;historyEvidence:string}>;
const profile='crest.dropoff-custody-source.v1',digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const nullable=new Set(['acknowledgement_text','prior_version','notes','missing_photo_reason','acknowledgement_confirmed',
 'condition_photo_id','display_width','display_height','bit_depth']);
const integers=new Set(['handoff_version','byte_size','width','height','display_width','display_height','bit_depth',
 'preview_byte_size','preview_width','preview_height']);
const booleans=new Set(['condition_photo_required','acknowledgement_confirmed']);
const commands=['operations.custody.policy.save',dropoffPolicyRevisionKind,'operations.custody.save','operations.custody.photo.reserve',
 'operations.custody.photo.publish','operations.custody.photo.access'];
const entities=['custody_authorization_configs','custody_cases','custody_photos','custody_photo_accesses'];
function check(value:unknown):asserts value{if(!value)throw Error('CUSTODY_SOURCE_REVIEW_REQUIRED');}
function object(value:unknown):asserts value is Record<string,unknown>{check(value!==null&&typeof value==='object'&&!Array.isArray(value));}
function hash(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function json(value:unknown){check(typeof value==='string');return parseHistoryJson(value);}
function snapshot(value:unknown){
 check(typeof value==='string');
 const parsed:unknown=JSON.parse(value);
 check(historyJsonEqual(json(value),parseHistoryJson(JSON.stringify(parsed))));
 return parsed;
}
function same(value:unknown,expected:unknown){return historyJsonEqual(value,parseHistoryJson(JSON.stringify(expected)));}
export function custodySourceKey(group:Group,row:Record<string,unknown>){return row[group==='custody_photo_originals'?'photo_id':'id'];}
function parseRow(group:Group,value:unknown,business:string):Row{
 check(exact(value,columns[group])&&value.business_id===business);
 for(const key of columns[group]){
  const item=value[key];
  if(item===null){check(nullable.has(key));continue;}
  if(integers.has(key)){check(typeof item==='number'&&Number.isSafeInteger(item)&&item>0);continue;}
  if(booleans.has(key)){check(typeof item==='boolean');continue;}
  check(typeof item==='string'&&!item.includes('\0')&&Buffer.from(item,'utf8').toString('utf8')===item);
  if(key==='id'||key.endsWith('_id')||key==='created_by'||key==='recovery_epoch')check(uuid(item));
  else if(key==='version'||key==='prior_version')check(version(item));
  else if(key.endsWith('_at'))check(instant(item));
  else if(key.endsWith('sha256'))check(hash(item));
  else if(key.endsWith('_snapshot'))object(json(item));
 }
 return Object.freeze({...value}) as Row;
}
function handoff(custody:Row,event:Row){
 return {schemaVersion:1,caseId:custody.id,jobId:custody.job_id,jobVehicleId:custody.job_vehicle_id,vehicleId:custody.vehicle_id,
  eventId:event.id,version:event.version,action:event.action,effectiveAt:event.effective_at,recordedAt:event.recorded_at,
  person:snapshot(event.person_snapshot),location:snapshot(event.location_snapshot),notes:event.notes,missingPhotoReason:event.missing_photo_reason,
  authorizationConfigId:custody.authorization_config_id,acknowledgementConfirmed:event.acknowledgement_confirmed,
  ...event.condition_photo_id!==null?{conditionPhotoId:event.condition_photo_id}:{}};
}

export function formatDropoffCustodySources(input:CustodySourceInput){
 check(exact(input,['context','rows','historyEvidence'])&&exact(input.context,
  ['schemaVersion','profile','businessId','snapshotToken','historySnapshotToken','expectedCounts'])&&
  input.context.schemaVersion===1&&input.context.profile===profile&&uuid(input.context.businessId)&&
  hash(input.context.snapshotToken)&&hash(input.context.historySnapshotToken)&&
  exact(input.context.expectedCounts,custodySourceGroups)&&exact(input.rows,custodySourceGroups));
 const rawContext=input.context,businessId=rawContext.businessId as string,rows={} as Record<Group,readonly Row[]>;
 const expectedCounts=rawContext.expectedCounts as Record<Group,unknown>;
 const context=Object.freeze({schemaVersion:1 as const,profile,businessId,
  snapshotToken:rawContext.snapshotToken as string,historySnapshotToken:rawContext.historySnapshotToken as string,
  expectedCounts:Object.freeze({...expectedCounts})});
 let total=0,bytes=0;
 for(const group of custodySourceGroups){
  const raw=input.rows[group],expected=expectedCounts[group];
  check(version(expected,true)&&Array.isArray(raw)&&BigInt(expected)===BigInt(raw.length)&&(total+=raw.length)<=10000);
  let last='';
  rows[group]=Object.freeze(raw.map(value=>{
   const row=parseRow(group,value,businessId),key=custodySourceKey(group,row);
   check(typeof key==='string'&&key>last);last=key;
   bytes+=Buffer.byteLength(JSON.stringify(row));check(bytes<=32*1024*1024);
   return row;
  }));
 }
 const history=verifyBusinessHistoryEvidence(input.historyEvidence,{businessId});
 check(history.context.snapshotToken===context.historySnapshotToken);
 const operations=new Map<string,Record<string,unknown>>(),audits=new Map<string,Record<string,unknown>>();
 const arrangementAudits=new Map<string,{row:Record<string,unknown>;entry:typeof history.records[number]}>();
 const selected=new Set<typeof history.records[number]>();
 for(const entry of history.records){
  const evidence=json(entry.canonicalEvidence);object(evidence);object(evidence.row);
  const row=evidence.row;
  if(entry.kind==='operation'&&commands.includes(row.command_type as string)){
   check(uuid(row.operation_id)&&!operations.has(row.operation_id));operations.set(row.operation_id,row);selected.add(entry);
  }
  if(entry.kind==='audit_event'&&entities.includes(row.entity_kind as string)){
   check(uuid(row.operation_id)&&!audits.has(row.operation_id));audits.set(row.operation_id,row);selected.add(entry);
  }
  if(entry.kind==='audit_event'&&row.entity_kind==='fulfillment_modes'){
   check(uuid(row.operation_id)&&!arrangementAudits.has(row.operation_id));arrangementAudits.set(row.operation_id,{row,entry});
  }
 }
 const used=new Set<string>();
 function evidence(operationId:unknown,kind:string,entity:string,entityId:unknown,entityVersion:string,action:string,actor?:unknown){
  check(uuid(operationId)&&!used.has(operationId));
  const op=operations.get(operationId),audit=audits.get(operationId);
  check(op&&audit&&op.command_type===kind&&op.state==='committed'&&op.origin==='manual'&&op.import_row_id===null&&
   historyJsonNumber(op.schema_version,1)&&historyJsonNumber(op.result_schema_version,1)&&op.created_by===op.actor_id&&
   (actor===undefined||op.actor_id===actor)&&audit.actor_id===op.actor_id&&audit.created_by===op.actor_id&&
   audit.entity_kind===entity&&audit.entity_id===entityId&&audit.entity_version===entityVersion&&audit.action===action&&
   audit.origin==='manual'&&audit.import_row_id===null);
  used.add(operationId);
  return {op,audit};
 }
 const policies=new Map(rows.custody_authorization_configs.map(row=>[row.id,row]));
 const policyByMode=new Map(rows.custody_authorization_configs.map(row=>[row.mode_version_id,row]));
 check(policyByMode.size===policies.size);
 for(const policy of policies.values()){
  const image={id:policy.id,modeVersionId:policy.mode_version_id,acknowledgementText:policy.acknowledgement_text,
   conditionPhotoRequired:policy.condition_photo_required};
  if(operations.get(String(policy.id))?.command_type===dropoffPolicyRevisionKind){
   const {op,audit}=evidence(policy.id,dropoffPolicyRevisionKind,'custody_authorization_configs',policy.id,'1','create');
   const arrangement=arrangementAudits.get(String(policy.id));
   check(arrangement&&arrangement.row.actor_id===op.actor_id&&arrangement.row.created_by===op.actor_id&&
    arrangement.row.entity_id===businessId&&arrangement.row.action==='revise'&&arrangement.row.origin==='manual'&&
    arrangement.row.import_row_id===null);
   const change=json(arrangement.row.delta);
   check(exact(change,['schemaVersion','before','after'])&&historyJsonNumber(change.schemaVersion,1));
   const prior=parseFulfillmentModeVersion(change.before,businessId),next=parseFulfillmentModeVersion(change.after,businessId);
   const priorPolicy=policyByMode.get(prior.id);
   check(priorPolicy&&prior.dropoff_enabled&&next.dropoff_enabled&&prior.mobile_enabled===next.mobile_enabled&&
    prior.pickup_return_enabled===next.pickup_return_enabled&&next.replaces_sequence===prior.sequence&&
    next.sequence===arrangement.row.entity_version&&next.operation_id===policy.id&&next.id===policy.mode_version_id&&
    next.created_by===op.actor_id&&(priorPolicy.acknowledgement_text!==policy.acknowledgement_text||
     priorPolicy.condition_photo_required!==policy.condition_photo_required));
   const input=parseDropoffPolicyRevision({schemaVersion:1,businessId,operationId:policy.id,recoveryEpoch:op.recovery_epoch,
    modeVersionId:prior.id,policyId:priorPolicy.id,body:{acknowledgementText:policy.acknowledgement_text,
     conditionPhotoRequired:policy.condition_photo_required,reason:next.reason}});
   parseDropoffPolicyRevisionCommitted({state:'committed',operationId:policy.id,recoveryEpoch:op.recovery_epoch,
    receipt:snapshot(op.result)},input);
   check(same(json(op.result),{schemaVersion:1,priorModeVersionId:prior.id,priorPolicyId:priorPolicy.id,
    sequence:next.sequence,policy:image,modeAuditId:arrangement.row.id,policyAuditId:audit.id})&&
    same(json(audit.delta),{schemaVersion:1,before:null,after:image}));
   selected.add(arrangement.entry);
   continue;
  }
  const {op,audit}=evidence(policy.id,'operations.custody.policy.save','custody_authorization_configs',policy.id,'1','create');
  parseDropoffPolicySave({schemaVersion:1,businessId,operationId:policy.id,recoveryEpoch:op.recovery_epoch,
   modeVersionId:policy.mode_version_id,body:{acknowledgementText:policy.acknowledgement_text,conditionPhotoRequired:policy.condition_photo_required}});
  check(same(json(op.result),{schemaVersion:1,policy:image})&&same(json(audit.delta),{schemaVersion:1,before:null,after:image}));
 }
 const cases=new Map(rows.custody_cases.map(row=>[row.id,row])),events=new Map(rows.custody_events.map(row=>[row.id,row]));
 const originals=new Map(rows.custody_photo_originals.map(row=>[row.photo_id,row]));
 const attempts=new Map(rows.custody_photo_attempts.map(row=>[row.id,row]));
 const booked=new Set(),held=new Set(),linkedPhotos=new Set();
 for(const custody of cases.values()){
  const policy=policies.get(custody.authorization_config_id),head=events.get(custody.current_event_id);
  check(policy&&head&&head.case_id===custody.id&&head.version===custody.version&&custody.mode==='dropoff'&&
   (custody.version==='1'&&custody.state==='held'||custody.version==='2'&&custody.state==='released')&&!booked.has(custody.job_vehicle_id));
  booked.add(custody.job_vehicle_id);
  if(custody.state==='held'){check(!held.has(custody.vehicle_id));held.add(custody.vehicle_id);}
 }
 const chains=new Map<unknown,Row>();
 const ordered=[...events.values()].sort((a,b)=>a.case_id===b.case_id?Number(a.version)-Number(b.version):String(a.case_id).localeCompare(String(b.case_id)));
 for(const event of ordered){
  const custody=cases.get(event.case_id),prior=chains.get(event.case_id);
  check(custody&&event.origin==='manual'&&event.effective_at!<=event.recorded_at!&&
   (prior?event.version==='2'&&event.prior_version==='1'&&event.action==='released'&&prior.effective_at!<=event.effective_at!:
    event.version==='1'&&event.prior_version===null&&event.action==='received'));
  const policy=policies.get(custody.authorization_config_id)!;
  const {op,audit}=evidence(event.operation_id,'operations.custody.save','custody_cases',custody.id,String(event.version),String(event.action),event.created_by);
  const payload=json(audit.payload);object(payload);
  parseDropoffCustodySave({schemaVersion:1,businessId,operationId:event.operation_id,recoveryEpoch:op.recovery_epoch,
   jobVehicleId:custody.job_vehicle_id,caseId:custody.id,expectedVersion:prior?'1':'0',body:{
    authorizationConfigId:policy.id,effectiveAt:event.effective_at,person:snapshot(event.person_snapshot),location:snapshot(event.location_snapshot),
    notes:event.notes,missingPhotoReason:event.missing_photo_reason,acknowledgementConfirmed:event.acknowledgement_confirmed,
    ...event.condition_photo_id!==null?{conditionPhotoId:event.condition_photo_id}:{}
   }});
  check(event.acknowledgement_confirmed===(policy.acknowledgement_text===null?null:true)&&
   (!policy.condition_photo_required||event.condition_photo_id!==null)&&payload.effectiveAt===event.effective_at&&
   same(json(op.result),{schemaVersion:1,caseId:custody.id,eventId:event.id,version:event.version})&&
   same(json(audit.delta),{schemaVersion:1,before:prior?handoff(custody,prior):null,after:handoff(custody,event)}));
  if(event.condition_photo_id!==null){
   const photo=originals.get(event.condition_photo_id),attempt=attempts.get(event.condition_photo_id);
   check(photo&&attempt&&!linkedPhotos.has(event.condition_photo_id)&&attempt.case_id===custody.id&&
    attempt.job_id===custody.job_id&&attempt.job_vehicle_id===custody.job_vehicle_id&&attempt.vehicle_id===custody.vehicle_id&&
    String(attempt.handoff_version)===event.version&&attempt.recovery_epoch===op.recovery_epoch&&photo.verified_at!<=event.recorded_at!);
   linkedPhotos.add(event.condition_photo_id);
  }
  chains.set(event.case_id,event);
 }
 check(chains.size===cases.size);
 for(const attempt of attempts.values()){
  check((attempt.handoff_version===1||attempt.handoff_version===2)&&Number(attempt.byte_size)<=26214400&&
   ['image/jpeg','image/png','image/heic'].includes(String(attempt.declared_type)));
  const base={photoId:attempt.id,jobId:attempt.job_id,jobVehicleId:attempt.job_vehicle_id,caseId:attempt.case_id,
   handoffVersion:attempt.handoff_version,declaredType:attempt.declared_type,byteSize:attempt.byte_size};
  const reservation=evidence(attempt.id,'operations.custody.photo.reserve','custody_photos',attempt.id,'1','reserve',attempt.actor_id);
  check(reservation.op.recovery_epoch===attempt.recovery_epoch&&
   same(json(reservation.op.result),{schemaVersion:1,photoId:attempt.id,status:'reserved'})&&
   same(json(reservation.audit.delta),{schemaVersion:1,before:null,after:base}));
  const original=originals.get(attempt.id);
  if(original){
   check(original.detected_type===attempt.declared_type&&original.byte_size===attempt.byte_size&&
    Number(original.width)*Number(original.height)<=60000000&&Number(original.preview_byte_size)<=8388608&&
    Number(original.preview_width)<=2048&&Number(original.preview_height)<=2048&&original.verified_at!>=attempt.reserved_at!);
   if(original.detected_type==='image/heic'){
    check(original.display_width!==null&&original.display_height!==null&&original.bit_depth!==null&&
     Number(original.display_width)*Number(original.display_height)<=60000000&&Number(original.bit_depth)>=8&&
     Number(original.bit_depth)<=16&&original.validation_version===heicValidationVersion);
   }else check(original.display_width===null&&original.display_height===null&&original.bit_depth===null&&
    original.validation_version===imageValidationVersion);
   const publication=evidence(attempt.dispatch_id,'operations.custody.photo.publish','custody_photos',attempt.id,'2','publish',attempt.actor_id);
   check(publication.op.recovery_epoch===attempt.recovery_epoch&&
    same(json(publication.op.result),{schemaVersion:1,photoId:attempt.id,status:'verified'})&&
    same(json(publication.audit.delta),{schemaVersion:1,before:base,after:{...base,sha256:original.sha256,
     previewSha256:original.preview_sha256,validationVersion:original.validation_version}}));
  }
 }
 check([...originals.keys()].every(key=>attempts.has(key)));
 for(const [operationId,operation] of operations){
  if(operation.command_type!=='operations.custody.photo.access')continue;
  const receipt=json(operation.result);object(receipt);object(receipt.scope);
  const scope=receipt.scope,photo=originals.get(scope.photoId as string),attempt=attempts.get(scope.photoId as string),event=events.get(scope.handoffEventId as string);
  check(photo&&attempt&&event&&event.condition_photo_id===scope.photoId&&event.case_id===attempt.case_id&&scope.jobVehicleId===attempt.job_vehicle_id);
  const expectedScope={photoId:photo.photo_id,jobVehicleId:attempt.job_vehicle_id,caseId:attempt.case_id,handoffEventId:event.id,
   sha256:photo.sha256,byteSize:photo.byte_size,contentType:photo.detected_type};
  check(same(scope,expectedScope));
  const {audit}=evidence(operationId,'operations.custody.photo.access','custody_photo_accesses',operationId,'1','authorized_handoff',attempt.actor_id);
  check(same(receipt,{schemaVersion:1,operationId,auditEventId:audit.id,scope:expectedScope})&&
   same(json(audit.delta),{schemaVersion:1,before:null,after:expectedScope}));
 }
 check(used.size===operations.size&&used.size===audits.size);
 const files:Record<string,string>={},escapes:{table:Group;rowId:string;column:string}[]=[];
 const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
 for(const group of custodySourceGroups){
  const lines=[columns[group].map(quote).join(',')];
  for(const row of rows[group])lines.push(columns[group].map(column=>{
   const original=row[column];if(original===null)return quote('\\N');
   let cell=String(original).replaceAll('\\','\\\\');
   if(typeof original==='string'&&(cell.startsWith("'")||/^[=+@-]/.test(cell.trimStart()))){
    cell="'"+cell;escapes.push({table:group,rowId:String(custodySourceKey(group,row)),column});
   }
   return quote(cell);
  }).join(','));
  files[group+'.csv']=lines.join('\r\n')+'\r\n';
 }
 files['custody_source.json']=JSON.stringify({context,rows,historyEvidence:{schemaVersion:1,snapshotToken:context.historySnapshotToken,
  records:history.records.filter(entry=>selected.has(entry))}})+'\n';
 files['custody_source_dictionary.json']=JSON.stringify({schemaVersion:1,profile,columns,escapes,
  booleans:[...booleans],integers:[...integers],jsonTextColumns:['person_snapshot','location_snapshot'],
  keyColumns:{custody_photo_originals:'photo_id',default:'id'},
  decode:'UTF-8 RFC4180 CRLF. Unescaped \\N is null. Remove exactly one mapped apostrophe, then unescape paired backslashes. JSON text and timestamps retain their original representation.'})+'\n';
 check(Object.values(files).every(value=>Buffer.byteLength(value)<=32*1024*1024));
 const manifest=JSON.stringify({schemaVersion:1,profile,businessId,snapshotToken:context.snapshotToken,
  historySnapshotToken:context.historySnapshotToken,expectedCounts:context.expectedCounts,sourceAuditClosureChecked:true,
  referenceClosureComplete:false,completePortableExport:false,completeBackup:false,photoBytesIncluded:false,
  parts:Object.entries(files).map(([name,content])=>({name,bytes:Buffer.byteLength(content),sha256:digest(content)}))})+'\n';
 return Object.freeze({files:Object.freeze(files),manifest,context,rows:Object.freeze(rows)});
}
