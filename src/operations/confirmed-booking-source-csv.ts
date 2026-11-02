// Private physical sources only. JSONB/range columns arrive as original SQL
// JSON text; never reserialize their values through JavaScript Number.
// This formatter proves included consistency, not collection authority/custody.
import {createHash} from 'node:crypto';
import {customerUuid,customerVersion,customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseHistoryJson,historyJsonNumber} from '../security/history-evidence-json.ts';
import {bookingRecordSchema,bookingRecordGroups,jobStates,appointmentStates} from './confirmed-booking-records.ts';
import type {BookingRecordGroup} from './confirmed-booking-records.ts';
import {requireBooking,parseBookingContact} from './confirmed-booking-contract.ts';
import {parseScheduleTime,scheduleTimeFields} from './schedule-time.ts';
import {parseFulfillmentModeVersion} from './fulfillment-mode-contract.ts';
type SourceRow=Readonly<Record<string,string|number|boolean|null>>;
export type BookingSourceInput=Readonly<{businessId:string;snapshotToken:string;commercialSnapshotToken:string;historySnapshotToken:string;expectedCounts:Readonly<Record<BookingRecordGroup,string>>;rows:Readonly<Record<BookingRecordGroup,readonly SourceRow[]>>}>;
const partLimit=8*1024*1024,totalLimit=32*1024*1024,quote=(s:string)=>'"'+s.replaceAll('"','""')+'"',sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex'),hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
function originalJson(v:unknown,nullable:boolean){requireBooking(typeof v==='string'&&Buffer.byteLength(v)<=partLimit&&Buffer.from(v,'utf8').toString('utf8')===v);const parsed=parseHistoryJson(v);requireBooking(object(parsed)||nullable&&parsed===null);return parsed;}
export function parseBookingSourceRecord(group:BookingRecordGroup,v:unknown,businessId:string):SourceRow{
 const schema=bookingRecordSchema[group];requireBooking(schema&&customerUuid(businessId)&&exact(v,Object.keys(schema))&&v.business_id===businessId);const parsed:Record<string,unknown>={};
 for(const [column,spec]of Object.entries(schema)){
  const value=v[column];if(value===null){requireBooking(spec.nullable);continue;}
  switch(spec.type){
   case 'uuid':requireBooking(customerUuid(value));break;
   case 'bigint':requireBooking(customerVersion(value,column.endsWith('_cents')));break;
   case 'timestamptz':requireBooking(customerInstant(value));break;
   case 'timestamp':requireBooking(typeof value==='string'&&customerInstant(value+'Z'));break;
   case 'integer':requireBooking(typeof value==='number'&&Number.isInteger(value)&&value>=-2147483648&&value<=2147483647);break;
   case 'boolean':requireBooking(typeof value==='boolean');break;
   case 'text':requireBooking(typeof value==='string'&&!value.includes('\0')&&Buffer.from(value,'utf8').toString('utf8')===value);break;
   case 'jsonb':parsed[column]=originalJson(value,spec.nullable);break;
   case 'tstzrange':{const range=originalJson(value,false);requireBooking(exact(range,['start_at','end_at','lower_inclusive','upper_inclusive'])&&customerInstant(range.start_at)&&customerInstant(range.end_at)&&range.end_at>range.start_at&&range.lower_inclusive===true&&range.upper_inclusive===false);parsed[column]=range;break;}
  }
 }
 requireBooking(v.origin==='manual');
 if(group==='fulfillment_mode_versions')parseFulfillmentModeVersion(v,businessId);
 if(group==='jobs'){
  requireBooking(jobStates.includes(v.state as typeof jobStates[number])&&['mobile','dropoff','pickup_return'].includes(v.fulfillment_mode as string)&&(v.updated_at as string)>=(v.created_at as string));const location=parsed.work_location_snapshot;requireBooking(object(location)&&historyJsonNumber(location.schemaVersion,1));
  if(location.kind==='manual')requireBooking(typeof location.locationText==='string'&&location.locationText.trim().length>0);
  else{const snapshot=location.snapshot;requireBooking(location.kind==='customer_address'&&customerUuid(location.addressId)&&customerVersion(location.addressVersion)&&object(snapshot)&&snapshot.id===location.addressId&&snapshot.version===location.addressVersion&&snapshot.business_id===businessId&&snapshot.customer_id===v.customer_id&&v.work_address_id===location.addressId);}
 }
 if(group==='job_vehicles'){const vehicle=parsed.vehicle_snapshot,customer=parsed.customer_snapshot;requireBooking(object(vehicle)&&object(customer)&&vehicle.business_id===businessId&&vehicle.id===v.vehicle_id&&customer.business_id===businessId&&customerUuid(customer.id));}
 if(group==='appointments'){
  requireBooking(appointmentStates.includes(v.confirmation_state as typeof appointmentStates[number]));parseScheduleTime(Object.fromEntries(scheduleTimeFields.map(key=>[key,v[key]])));parseBookingContact(parsed.contact_snapshot);requireBooking(v.sequence==='1'?v.replaces_id===null:v.replaces_id!==null);
  for(const key of ['travel_before_seconds','travel_after_seconds'])requireBooking(v[key]===null||(v[key] as number)>=0);
  if(v.confirmation_state==='confirmed'){const c=parsed.customer_confirmation;requireBooking(exact(c,['channel','effectiveAt','evidenceNote'])&&['text','phone','email','in_person'].includes(c.channel as string)&&customerInstant(c.effectiveAt)&&c.effectiveAt<=(v.created_at as string)&&typeof c.evidenceNote==='string'&&c.evidenceNote.trim().length>0);}
 }
 if(group==='allocation_plan_versions')requireBooking(v.sequence==='1'?v.replaces_id===null:v.replaces_id!==null);
 if(group==='allocation_plan_parts')requireBooking(['unassigned','assigned','completed','cancelled'].includes(v.allocation_state as string)&&(v.job_id===null)===(v.allocation_state==='unassigned')&&BigInt(v.gross_inclusive_cents as string)-BigInt(v.discount_inclusive_cents as string)===BigInt(v.amount_cents as string)&&typeof v.scope_description==='string'&&v.scope_description.trim().length>0);
 if(group==='job_events')requireBooking((v.from_state===null||jobStates.includes(v.from_state as typeof jobStates[number]))&&jobStates.includes(v.to_state as typeof jobStates[number])&&(v.effective_at as string)<=(v.created_at as string));
 return Object.freeze({...v}) as SourceRow;
}
export function formatBookingSourceCsv(input:BookingSourceInput){
 requireBooking(exact(input,['businessId','snapshotToken','commercialSnapshotToken','historySnapshotToken','expectedCounts','rows'])&&customerUuid(input.businessId)&&[input.snapshotToken,input.commercialSnapshotToken,input.historySnapshotToken].every(hash)&&exact(input.expectedCounts,bookingRecordGroups)&&exact(input.rows,bookingRecordGroups));
 const rows={} as Record<BookingRecordGroup,SourceRow[]>;let recordCount=0,inputBytes=0;const actors=new Set<string>(),operations=new Map<string,string>();
 for(const group of bookingRecordGroups){const expected=input.expectedCounts[group],source=input.rows[group];requireBooking(customerVersion(expected,true)&&BigInt(expected)<=10000n&&Array.isArray(source)&&source.length===Number(expected));const ids=new Set<string>();rows[group]=source.map(v=>{inputBytes+=Buffer.byteLength(JSON.stringify(v));requireBooking(inputBytes<=totalLimit);const row=parseBookingSourceRecord(group,v,input.businessId);requireBooking(!ids.has(row.id as string));ids.add(row.id as string);actors.add(row.created_by as string);if(row.updated_by)actors.add(row.updated_by as string);if(row.operator_actor_id)actors.add(row.operator_actor_id as string);const actor=(row.updated_by??row.created_by) as string,old=operations.get(row.operation_id as string);requireBooking(old===undefined||old===actor);operations.set(row.operation_id as string,actor);return row;}).sort((a,b)=>(a.id as string)<(b.id as string)?-1:1);recordCount+=rows[group].length;requireBooking(recordCount<=10000);}
 // Internal physical references only. External CRM/commercial/actor/audit
 // closure must be supplied by the complete same-snapshot business exporter.
 const maps=Object.fromEntries(bookingRecordGroups.map(group=>[group,new Map(rows[group].map(row=>[row.id,row]))])) as Record<BookingRecordGroup,Map<string,SourceRow>>;
 const get=(group:BookingRecordGroup,id:unknown)=>{requireBooking(typeof id==='string');const row=maps[group].get(id);requireBooking(row);return row;};
 const modes=[...rows.fulfillment_mode_versions].sort((a,b)=>BigInt(a.sequence as string)<BigInt(b.sequence as string)?-1:1);for(const [i,mode]of modes.entries())requireBooking(mode.sequence===String(i+1)&&(i===0?mode.replaces_sequence===null:mode.replaces_sequence===modes[i-1]!.sequence));
 for(const row of rows.jobs){const a=get('appointments',row.current_appointment_id);requireBooking(a.job_id===row.id);get('fulfillment_mode_versions',row.mode_version_id);}
 for(const group of ['job_vehicles','job_encounters','appointments','schedule_reservations','schedule_overrides','job_events'] as const)for(const row of rows[group]){const j=get('jobs',row.job_id);if(group==='job_encounters')requireBooking(row.customer_id===j.customer_id);if(group==='job_vehicles'){const snapshot=parseHistoryJson(row.customer_snapshot as string) as Record<string,unknown>;requireBooking(snapshot.id===j.customer_id);}}
 for(const a of rows.appointments)if(a.replaces_id!==null){const before=get('appointments',a.replaces_id);requireBooking(before.job_id===a.job_id&&BigInt(before.sequence as string)+1n===BigInt(a.sequence as string));}
 for(const r of rows.schedule_reservations){const j=get('jobs',r.job_id),a=get('appointments',r.appointment_id);requireBooking(a.job_id===j.id&&j.current_appointment_id===a.id&&r.operator_actor_id===j.operator_actor_id);if(r.override_id!==null){const override=get('schedule_overrides',r.override_id);requireBooking(override.job_id===r.job_id&&override.appointment_id===r.appointment_id);}}
 for(const o of rows.schedule_overrides)requireBooking(get('appointments',o.appointment_id).job_id===o.job_id);
 for(const link of rows.schedule_override_conflicts){const override=get('schedule_overrides',link.override_id);get('appointments',link.conflicting_appointment_id);requireBooking(override.appointment_id!==link.conflicting_appointment_id);}
 for(const p of rows.allocation_plan_versions)if(p.replaces_id!==null){const before=get('allocation_plan_versions',p.replaces_id);requireBooking(before.source_allocation_id===p.source_allocation_id&&BigInt(before.sequence as string)+1n===BigInt(p.sequence as string));}
 const partitionSources=new Map<string,string>();for(const part of rows.allocation_plan_parts){const plan=get('allocation_plan_versions',part.plan_id),source=plan.source_allocation_id as string,previous=partitionSources.get(part.stable_partition_id as string);requireBooking(previous===undefined||previous===source);partitionSources.set(part.stable_partition_id as string,source);if(part.job_id!==null)get('jobs',part.job_id);}
 const tables={} as Record<BookingRecordGroup,Readonly<{csv:string;escapeMap:string;dictionary:string}>>;let total=0;
 for(const group of bookingRecordGroups){const fields=bookingRecordSchema[group],columns=Object.keys(fields),escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[],lines=[columns.map(quote).join(',')];let bytes=Buffer.byteLength(lines[0]!)+2;
  for(const row of rows[group]){const line=columns.map(column=>{const original=row[column];if(original===null)return quote('\\N');let value=String(original).replaceAll('\\','\\\\');if(value.startsWith("'")||['=','+','-','@'].includes(value.trimStart()[0]??'')){value="'"+value;escapes.push({row_id:row.id as string,column,apostrophe_prefix:true});}return quote(value);}).join(',');bytes+=Buffer.byteLength(line)+2;requireBooking(bytes<=partLimit);lines.push(line);}
  tables[group]=Object.freeze({csv:lines.join('\r\n')+'\r\n',escapeMap:JSON.stringify({schemaVersion:1,entity:group,businessId:input.businessId,snapshotToken:input.snapshotToken,keyColumns:['id'],escapes})+'\n',dictionary:JSON.stringify({schemaVersion:1,entity:group,columns,schema:fields,keyColumns:['id'],jsonTextColumns:Object.entries(fields).filter(([,v])=>v.type==='jsonb'||v.type==='tstzrange').map(([key])=>key),format:'UTF-8 RFC4180 CRLF, all cells quoted. UUIDs, bigints, instants and local timestamps remain text. Integer/boolean columns decode only according to schema. JSONB/range cells retain original SQL JSON text, including numeric scale; do not reserialize through Number.',null:'Unescaped \\N is SQL NULL; literal JSON null remains the four-character JSON text null.',decode:'Parse CSV. Test the unescaped SQL NULL marker first. Remove exactly one apostrophe only for mapped row/column cells, then unescape paired backslashes. Keep JSON text unchanged; parse in a lossless reader or SQL JSONB. Range JSON uses start_at/end_at UTC and lower_inclusive=true, upper_inclusive=false.',assurance:'Included physical-source consistency only. Not complete business export, collection authorization or backup.'})+'\n'});requireBooking(Object.values(tables[group]).every(s=>Buffer.byteLength(s)<=partLimit));total+=Object.values(tables[group]).reduce((n,s)=>n+Buffer.byteLength(s),0);requireBooking(total<=totalLimit);
 }
 const references=JSON.stringify({schemaVersion:1,businessId:input.businessId,snapshotToken:input.snapshotToken,requiredActorIds:[...actors].sort(),requiredOperations:[...operations].sort(([a],[b])=>a<b?-1:1).map(([operationId,actorId])=>({operationId,actorId})),requiredSourceAllocationIds:[...new Set(rows.allocation_plan_versions.map(v=>v.source_allocation_id))].sort(),externalReferenceClosureComplete:false,internalPhysicalReferencesChecked:true})+'\n';
 const parts=bookingRecordGroups.flatMap(group=>Object.entries(tables[group]).map(([kind,content])=>({name:group+(kind==='csv'?'.csv':kind==='escapeMap'?'_escape_map.json':'_dictionary.json'),content})));parts.push({name:'booking_source_references.json',content:references});const manifest=JSON.stringify({schemaVersion:1,scope:'confirmed_booking_sources',businessId:input.businessId,snapshotToken:input.snapshotToken,commercialSnapshotToken:input.commercialSnapshotToken,historySnapshotToken:input.historySnapshotToken,recordCounts:input.expectedCounts,parts:parts.map(({name,content})=>({name,bytes:Buffer.byteLength(content),sha256:sha(content)})),internalPhysicalReferencesChecked:true,externalReferenceClosureComplete:false,completePortableExport:false,completeBackup:false})+'\n';requireBooking(total+Buffer.byteLength(references)+Buffer.byteLength(manifest)<=totalLimit);return Object.freeze({tables:Object.freeze(tables),references,manifest});
}
