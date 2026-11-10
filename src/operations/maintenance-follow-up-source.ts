import {createHash} from 'node:crypto';
import {customerInstant as instant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {verifyBusinessHistoryEvidence} from '../security/business-history-evidence.ts';
import {historyJsonEqual,historyJsonNumber,parseHistoryJson} from '../security/history-evidence-json.ts';
import {maintenanceFollowUpKind,parseMaintenanceFollowUpRecord,parseMaintenanceFollowUpSave} from './maintenance-follow-up-contract.ts';

const profile='crest.maintenance-follow-up-source.v1';
const columns={
 follow_up_tasks:['id','business_id','customer_id','vehicle_id','source_job_id','due_at','created_at','created_by','operation_id','origin'],
 follow_up_task_events:['id','business_id','task_id','version','prior_version','kind','snoozed_until','rebooking_job_id','reason','created_at','created_by','operation_id','origin'],
} as const;
export const maintenanceSourceGroups=['follow_up_tasks','follow_up_task_events'] as const;
type Group=typeof maintenanceSourceGroups[number];
type Row=Readonly<Record<string,string|null>>;
const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
function check(value:unknown):asserts value{if(!value)throw Error('MAINTENANCE_SOURCE_REVIEW_REQUIRED');}
function hash(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function nullableUuid(value:unknown){return value===null||uuid(value);}
function json(value:unknown){check(typeof value==='string');return parseHistoryJson(value);}
function sameJson(value:unknown,expected:unknown){return historyJsonEqual(value,parseHistoryJson(JSON.stringify(expected)));}

function parseRow(group:Group,row:unknown,businessId:string):Row{
 check(exact(row,columns[group])&&row.business_id===businessId&&uuid(row.id)&&instant(row.created_at)&&
  uuid(row.created_by)&&uuid(row.operation_id)&&row.origin==='manual');
 if(group==='follow_up_tasks'){
  check(uuid(row.customer_id)&&nullableUuid(row.vehicle_id)&&nullableUuid(row.source_job_id)&&instant(row.due_at));
 }else{
  check(uuid(row.task_id)&&version(row.version)&&
   (row.kind==='created'?row.version==='1'&&row.prior_version===null:version(row.prior_version)&&BigInt(row.prior_version)+1n===BigInt(row.version))&&
   (row.kind==='snoozed'?instant(row.snoozed_until):row.snoozed_until===null)&&nullableUuid(row.rebooking_job_id)&&
   (row.reason===null||typeof row.reason==='string'));
 }
 return Object.freeze(Object.fromEntries(columns[group].map(key=>[key,row[key]]))) as Row;
}
function projection(task:Row,event:Row){
 return parseMaintenanceFollowUpRecord({schemaVersion:1,taskId:task.id,customerId:task.customer_id,
  vehicleId:task.vehicle_id,sourceJobId:task.source_job_id,dueAt:task.due_at,version:event.version,
  eventId:event.id,state:event.kind==='created'?'open':event.kind,snoozedUntil:event.snoozed_until,
  rebookingJobId:event.rebooking_job_id,reason:event.reason,recordedAt:event.created_at},task.id!);
}
function checkEvent(task:Row,event:Row,prior:Row|null,operation:Record<string,unknown>,audit:Record<string,unknown>){
 const current=projection(task,event);
 check(operation.actor_id===event.created_by&&operation.state==='committed'&&operation.origin==='manual'&&
  operation.import_row_id===null&&historyJsonNumber(operation.schema_version,1)&&historyJsonNumber(operation.result_schema_version,1));
 check(audit.actor_id===event.created_by&&audit.operation_id===event.operation_id&&audit.entity_id===task.id&&
  audit.entity_version===event.version&&audit.action===event.kind&&audit.origin==='manual');
 const original=json(operation.result);
 check(exact(original,['schemaVersion','request','receipt'])&&historyJsonNumber(original.schemaVersion,1));
 const saved=original.request;
 check(exact(saved,['schemaVersion','commandType','businessId','actorId','operationId','recoveryEpoch','taskId','expectedVersion','body'])&&
  historyJsonNumber(saved.schemaVersion,1)&&saved.commandType===maintenanceFollowUpKind&&saved.actorId===event.created_by&&
  saved.businessId===task.business_id&&saved.recoveryEpoch===operation.recovery_epoch&&saved.taskId===task.id&&
  saved.operationId===event.operation_id&&saved.expectedVersion===(prior?.version??'0'));
 const request=parseMaintenanceFollowUpSave({schemaVersion:1,businessId:saved.businessId,operationId:saved.operationId,
  recoveryEpoch:saved.recoveryEpoch,taskId:saved.taskId,expectedVersion:saved.expectedVersion,body:saved.body});
 const body=request.body;
 check(body.kind===event.kind&&body.reason===event.reason);
 if(body.kind==='created'){
  check(!prior&&task.operation_id===event.operation_id&&task.created_by===event.created_by&&body.customerId===task.customer_id&&
   body.vehicleId===task.vehicle_id&&body.sourceJobId===task.source_job_id&&body.dueAt===task.due_at&&task.created_at!<=event.created_at!);
 }else{
  check(prior&&(prior.kind==='created'||prior.kind==='snoozed')&&prior.created_at!<=event.created_at!&&
   body.snoozedUntil===event.snoozed_until&&body.rebookingJobId===event.rebooking_job_id);
 }
 check(sameJson(original.receipt,{schemaVersion:1,businessId:task.business_id,operationId:event.operation_id,record:current,auditId:audit.id}));
 check(sameJson(json(audit.delta),{schemaVersion:1,before:prior?projection(task,prior):null,after:current}));
}

export function formatMaintenanceFollowUpSources(input:unknown){
 check(exact(input,['context','rows','historyEvidence'])&&exact(input.context,
  ['schemaVersion','profile','businessId','snapshotToken','historySnapshotToken','expectedCounts'])&&
  input.context.schemaVersion===1&&input.context.profile===profile&&uuid(input.context.businessId)&&hash(input.context.snapshotToken)&&
  hash(input.context.historySnapshotToken)&&exact(input.context.expectedCounts,maintenanceSourceGroups)&&
  exact(input.rows,maintenanceSourceGroups)&&typeof input.historyEvidence==='string');
 const context=input.context,businessId=context.businessId as string,expectedCounts=context.expectedCounts as Record<Group,unknown>;
 const rows={} as Record<Group,readonly Row[]>;
 let total=0;
 for(const group of maintenanceSourceGroups){
  const count=expectedCounts[group],raw=input.rows[group];
  check(version(count,true)&&Array.isArray(raw)&&BigInt(count)===BigInt(raw.length)&&(total+=raw.length)<=10000);
  const parsed=raw.map(row=>parseRow(group,row,businessId));
  check(parsed.every((row,index)=>index===0||parsed[index-1]!.id!<row.id!));
  rows[group]=Object.freeze(parsed);
 }
 const history=verifyBusinessHistoryEvidence(input.historyEvidence,{businessId});
 check(history.context.snapshotToken===context.historySnapshotToken);
 const operations=new Map<string,Record<string,unknown>>(),audits=new Map<string,Record<string,unknown>>();
 const selectedEvidence:typeof history.records[number][]=[];
 for(const entry of history.records){
  const evidence=json(entry.canonicalEvidence);
  check(evidence&&typeof evidence==='object'&&'row' in evidence&&evidence.row&&typeof evidence.row==='object');
  const row=evidence.row as Record<string,unknown>;
  if(entry.kind==='operation'&&row.command_type===maintenanceFollowUpKind){
   check(uuid(row.operation_id)&&!operations.has(row.operation_id));operations.set(row.operation_id,row);
   selectedEvidence.push(entry);
  }
  if(entry.kind==='audit_event'&&row.entity_kind==='follow_up_tasks'){
   check(uuid(row.operation_id)&&!audits.has(row.operation_id));audits.set(row.operation_id,row);
   selectedEvidence.push(entry);
  }
 }
 const tasks=new Map(rows.follow_up_tasks.map(row=>[row.id,row]));
 const prior=new Map<string,Row>(),events=[...rows.follow_up_task_events].sort((a,b)=>{
  if(a.task_id!==b.task_id)return a.task_id!<b.task_id!?-1:1;
  return BigInt(a.version!)<BigInt(b.version!)?-1:1;
 });
 for(const event of events){
  const task=tasks.get(event.task_id),previous=prior.get(event.task_id!)??null,operation=operations.get(event.operation_id!),audit=audits.get(event.operation_id!);
  check(task&&operation&&audit&&event.prior_version===(previous?.version??null));
  checkEvent(task,event,previous,operation,audit);
  operations.delete(event.operation_id!);audits.delete(event.operation_id!);prior.set(event.task_id!,event);
 }
 check(prior.size===tasks.size&&operations.size===0&&audits.size===0);
 const files:Record<string,string>={},escapes:{table:Group;rowId:string;column:string}[]=[];
 const csv=(value:string)=>'"'+value.replaceAll('"','""')+'"';
 for(const group of maintenanceSourceGroups){
  const fields=columns[group],lines=[fields.map(csv).join(',')];
  for(const row of rows[group])lines.push(fields.map(column=>{
   const value=row[column];
   if(value===null)return csv('\\N');
   check(typeof value==='string');
   let encoded=value.replaceAll('\\','\\\\');
   if(encoded.startsWith("'")||['=','+','-','@'].includes(encoded.trimStart()[0]??'')){
    encoded="'"+encoded;escapes.push({table:group,rowId:row.id!,column});
   }
   return csv(encoded);
  }).join(','));
  files[group+'.csv']=lines.join('\r\n')+'\r\n';
 }
 files['maintenance_follow_up_source.json']=JSON.stringify({context,rows,
  historyEvidence:{schemaVersion:1,snapshotToken:history.context.snapshotToken,records:selectedEvidence}})+'\n';
 files['maintenance_follow_up_csv_dictionary.json']=JSON.stringify({schemaVersion:1,profile,columns,escapes,
  encoding:'UTF-8 RFC4180 CRLF. Read \\N as SQL null before unescaping. Remove the mapped leading apostrophe and unescape paired backslashes.'})+'\n';
 check(Object.values(files).every(value=>Buffer.byteLength(value)<=32*1024*1024));
 const manifest=JSON.stringify({schemaVersion:1,profile,businessId,snapshotToken:context.snapshotToken,
  historySnapshotToken:context.historySnapshotToken,expectedCounts,sourceAuditClosureChecked:true,
  completePortableExport:false,completeBackup:false,parts:Object.entries(files).map(([name,content])=>
   ({name,bytes:Buffer.byteLength(content),sha256:digest(content)}))})+'\n';
 return Object.freeze({files:Object.freeze(files),manifest});
}
