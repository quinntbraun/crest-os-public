import {strToU8,zipSync} from 'fflate';
import {customerUuid} from '../customer/customer-contract';
import {parseMaintenanceFollowUpRecord} from './maintenance-follow-up-contract';

const columns=['task_id','customer_id','vehicle_id','source_job_id','due_at','version','event_id',
 'state','snoozed_until','rebooking_job_id','reason','recorded_at'] as const;
const maxBytes=8*1024*1024;
export const maintenanceArchiveMaxVersions=1000;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';

function check(value:unknown):asserts value{
 if(!value)throw Error('MAINTENANCE_ARCHIVE_REVIEW_REQUIRED');
}

export async function buildMaintenanceFollowUpArchive(businessId:string,taskId:string,latest:unknown,history:readonly unknown[]){
 const head=parseMaintenanceFollowUpRecord(latest,taskId);
 check(customerUuid(businessId)&&history.length<=maintenanceArchiveMaxVersions&&String(history.length)===head.version);
 const events=history.map((value,index)=>{
  const row=parseMaintenanceFollowUpRecord(value,taskId);
  check(row.version===String(index+1)&&row.customerId===head.customerId&&row.vehicleId===head.vehicleId&&
   row.sourceJobId===head.sourceJobId&&row.dueAt===head.dueAt);
  return row;
 });
 check(new Set(events.map(row=>row.eventId)).size===events.length&&JSON.stringify(events.at(-1))===JSON.stringify(head));
 check(events.slice(0,-1).every(row=>row.state==='open'||row.state==='snoozed'));
 const escapes:{event_id:string;column:'reason';apostrophe_prefix:true}[]=[];
 const lines=events.map(row=>{
  const reason=row.reason?.replaceAll('\\','\\\\')??null;
  const escaped=reason!==null&&(/^\s*[=+@-]/.test(reason)||reason.startsWith("'"));
  if(escaped)escapes.push({event_id:row.eventId,column:'reason',apostrophe_prefix:true});
  return [row.taskId,row.customerId,row.vehicleId,row.sourceJobId,row.dueAt,row.version,row.eventId,row.state,
   row.snoozedUntil,row.rebookingJobId,escaped?"'"+reason:reason,row.recordedAt].map(value=>quote(value??'\\N')).join(',');
 });
 const scope={schemaVersion:1,profile:'crest.maintenance-reminder-history.v1',businessId,taskId,
  throughVersion:head.version,completeCrestExport:false,completeBackup:false,unsavedDraftIncluded:false};
 const parts:Record<string,Uint8Array>={
  'maintenance_reminder_history.csv':strToU8([columns.map(quote).join(','),...lines].join('\r\n')+'\r\n'),
  'saved_history.json':strToU8(JSON.stringify({...scope,events})+'\n'),
  'dictionary.json':strToU8(JSON.stringify({...scope,columns,escapes,
   csv:'UTF-8 RFC4180 CRLF with all cells quoted.',
   decode:'Unescaped \\N is null. Remove one leading apostrophe only from mapped cells, then unescape paired backslashes in reason.',
   coverage:'Saved display history of one reminder through the stated version.',
   excluded:['original_operation_payloads_and_receipts','audit_hash_inputs','referenced_customer_vehicle_and_job_records']})+'\n'),
 };
 check(Object.values(parts).reduce((total,part)=>total+part.length,0)<=maxBytes);
 const files=await Promise.all(Object.entries(parts).map(async([name,bytes])=>{
  const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
  return {name,bytes:bytes.length,sha256:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')};
 }));
 parts['manifest.json']=strToU8(JSON.stringify({...scope,files})+'\n');
 const archive=zipSync(parts,{level:0});
 check(archive.length<=maxBytes);
 return new Uint8Array(archive);
}
