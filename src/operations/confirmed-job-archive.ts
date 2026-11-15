// Saved display history, deliberately separate from original SQL/hash source.
import {zipSync,strToU8} from 'fflate';
import {parseJobDetail,parseJobHistoryPage} from './confirmed-job-read-contract.ts';
import type {JobHistoryEvent} from './confirmed-job-read-contract.ts';
import {bookingRecordSchema} from './confirmed-booking-records.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';

const limit=8*1024*1024,quote=(v:string)=>'"'+v.replaceAll('"','""')+'"';
const eventColumns=['id','sequence','operationId','actorId','recordedAt','effectiveAt','fromState','toState','reason','action','appointmentId','draft','customerCommunication','conflictReview'] as const;
export async function buildConfirmedJobArchive(input:{head:unknown;events:readonly unknown[]}):Promise<Uint8Array<ArrayBuffer>>{
 check(!!input.head&&typeof input.head==='object'&&!Array.isArray(input.head));const raw=input.head as Record<string,unknown>;
 const job=raw.job;check(!!job&&typeof job==='object'&&!Array.isArray(job));const identity=job as Record<string,unknown>;
 const head=parseJobDetail(input.head,identity.business_id as string,identity.id as string);check(!('state' in head));
 check(BigInt(head.job.version)<=1000n&&Array.isArray(input.events)&&BigInt(input.events.length)===BigInt(head.job.version));
 // Parse consecutive bounded pages just as the normal authenticated reader does.
 const events:JobHistoryEvent[]=[];for(let start=0;start<input.events.length;start+=20){
  const result=parseJobHistoryPage({schemaVersion:1,businessId:head.businessId,jobId:head.job.id,throughVersion:head.job.version,observedVersion:head.job.version,events:input.events.slice(start,start+20),hasMore:start+20<input.events.length},{businessId:head.businessId,jobId:head.job.id,throughVersion:head.job.version,afterVersion:String(start),pageSize:20});
  check(!('state' in result));events.push(...result.events);
 }
 check(new Set(events.map(e=>e.id)).size===events.length&&new Set(events.map(e=>e.operationId)).size===events.length);
 for(let i=1;i<events.length;i++)check(events[i]!.fromState===events[i-1]!.toState);
 // The event is inserted after its job update. Its recorded timestamp is
 // deliberately later; the command's effective timestamp binds that update.
 // Field commands capture the physical action time before appending interval
 // evidence and updating the job. The job's own stamp is deliberately later.
 // Keep both exact source timestamps; booking/schedule changes retain their
 // original equality requirement and every action still binds the head.
 const last=events.at(-1)!;check(last.toState===head.job.state&&last.actorId===head.job.updated_by&&last.operationId===head.job.operation_id&&(last.action==='state_change'?last.effectiveAt<=head.job.updated_at:last.effectiveAt===(last.action==='book'?head.job.created_at:head.job.updated_at))&&last.recordedAt>=head.job.updated_at);
 const appointments=events.flatMap(e=>e.appointment?[e.appointment]:[]);
 check(appointments.length>0&&new Set(appointments.map(a=>a.id)).size===appointments.length);
 for(let i=0;i<appointments.length;i++)check(appointments[i]!.sequence===String(i+1)&&appointments[i]!.replaces_id===(i===0?null:appointments[i-1]!.id));
 const ordered=(v:unknown):unknown=>Array.isArray(v)?v.map(ordered):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,ordered(value)])):v;
 const same=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
 check(same(appointments.at(-1),head.latestAppointment)&&appointments.some(a=>a.id===head.appointment.id&&same(a,head.appointment)));
 const scope={schemaVersion:1,profile:'crest.confirmed-job-history.v1',businessId:head.businessId,jobId:head.job.id,throughVersion:head.job.version,latestEventId:last.id,completeCrestExport:false,completeBackup:false,referenceClosureComplete:false,originalHashInputsIncluded:false,unsavedDraftIncluded:false};
 const parts:Record<string,Uint8Array>={};let total=0;
 const add=(name:string,value:string)=>{const bytes=strToU8(value);total+=bytes.length;check(total<=limit);parts[name]=bytes;};
 const csv=(name:string,columns:readonly string[],rows:readonly Record<string,unknown>[])=>{
  const escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[];let bytes=0;
  const lines=[columns.map(quote).join(',')];for(const row of rows){const line=columns.map(column=>{
   const original=row[column];check(original!==undefined);if(original===null)return quote('\\N');
   let value=(typeof original==='object'?JSON.stringify(original):String(original)).replaceAll('\\','\\\\');
   if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(value.replace(/^\s+/,'')[0]??''))){value="'"+value;escapes.push({row_id:row.id as string,column,apostrophe_prefix:true});}
   return quote(value);
  }).join(',');bytes+=strToU8(line).length+2;check(bytes<=limit);lines.push(line);}
  add(name+'.csv',lines.join('\r\n')+'\r\n');add(name+'_escape_map.json',JSON.stringify({...scope,entity:name,escapes})+'\n');
 };
 csv('job',Object.keys(bookingRecordSchema.jobs),[head.job]);
 csv('appointments',Object.keys(bookingRecordSchema.appointments),appointments);
 csv('history',eventColumns,events.map(e=>({id:e.id,sequence:e.sequence,operationId:e.operationId,actorId:e.actorId,recordedAt:e.recordedAt,effectiveAt:e.effectiveAt,fromState:e.fromState,toState:e.toState,reason:e.reason,action:e.action,appointmentId:e.appointment?.id??null,draft:e.draft,customerCommunication:e.customerCommunication,conflictReview:e.conflictReview??null})));
 add('saved_job_history.json',JSON.stringify({...scope,head,events})+'\n');
 add('dictionary.json',JSON.stringify({...scope,csv:'UTF-8 RFC4180 CRLF; all cells quoted',null:'Unescaped \\N',decode:'Parse CSV. Unescaped \\N is SQL null. Remove exactly one leading apostrophe only for cells in that table escape map; then unescape paired backslashes. JSON columns contain normalized display objects, not original SQL JSON text. IDs, sequence/version numbers and UTC/local timestamps remain strings.',columns:{job:bookingRecordSchema.jobs,appointments:bookingRecordSchema.appointments,history:eventColumns},jsonColumns:{job:['work_location_snapshot'],appointments:['customer_confirmation','contact_snapshot'],history:['draft','customerCommunication','conflictReview']},coverage:'One saved job head and its complete immutable display-history prefix. The head and prepared confirmation text are not proof of sent messages.',excluded:['original_operation_payloads_and_receipts','audit_event_hash_inputs','complete_vehicle_encounter_and_scope_records','referenced_CRM_and_commercial_source','attachments','configuration','credentials']})+'\n');
 const manifest=[];for(const [name,bytes] of Object.entries(parts)){const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));manifest.push({name,bytes:bytes.length,sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')});}
 add('manifest.json',JSON.stringify({...scope,parts:manifest})+'\n');const zipped=zipSync(parts,{level:0});check(zipped.length<=limit);return new Uint8Array(zipped);
}
