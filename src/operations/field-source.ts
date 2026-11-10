// Private included-domain sources. Capture authority, external parent closure,
// complete business portability and a recoverable backup remain separate gates.
import {createHash} from 'node:crypto';
import {customerUuid as uuid,customerInstant as instant,customerVersion as version} from '../customer/customer-contract.ts';
import {fieldSourceGroups,fieldSourceSchema} from './field-source-schema.ts';
import type {FieldSourceGroup} from './field-source-schema.ts';
import {recordedOperatorOccupancy} from './work-occupancy.ts';
import {prepareMileageBody} from './mileage.ts';
import {workBoundaryKind} from './job-work-boundary-contract.ts';
import {verifyBusinessHistoryEvidence} from '../security/business-history-evidence.ts';
import {formatBusinessHistoryCsv} from '../security/business-history-csv.ts';
import {parseHistoryJson,historyJsonEqual,historyJsonNumber,historyJsonBigint} from '../security/history-evidence-json.ts';
type Row=Readonly<Record<string,string|boolean|null>>;
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
  for(const record of history.records){
   const body=parseHistoryJson(record.canonicalEvidence);object(body);object(body.row);
   const r=body.row,id=r.operation_id as string;
   if(record.kind==='operation'){operations.set(id,r);continue;}
   if(operations.get(id)?.command_type===workBoundaryKind){
    check(r.entity_kind==='work_intervals');
    const ids=boundaryAuditIds.get(id)??[];ids.push(record.recordId);boundaryAuditIds.set(id,ids);
   }
   if(fieldSourceGroups.includes(r.entity_kind as FieldSourceGroup)){
    const key=[r.entity_kind,r.entity_id,typeof r.entity_version==='string'?r.entity_version:historyJsonBigint(r.entity_version)?.toString()].join(':');
    check(!audits.has(key));audits.set(key,r);
   }
  }
  const used=new Set<string>();for(const group of fieldSourceGroups)for(const row of rows[group]){
   const logical=group==='work_intervals'||group==='travel_legs'?row.logical_id:group==='mileage_evidence'?row.leg_id:row.id,sequence=['work_intervals','travel_legs','mileage_evidence'].includes(group)?row.sequence:'1',key=[group,logical,sequence].join(':'),audit=audits.get(key),operation=operations.get(row.operation_id as string);check(audit&&operation&&!used.has(key));used.add(key);
   check(audit.operation_id===row.operation_id&&audit.actor_id===row.created_by&&audit.created_by===row.created_by&&operation.actor_id===row.created_by&&operation.state==='committed'&&audit.reason===(row.reason??null));const delta=parseHistoryJson(audit.delta as string);shape(delta,['schemaVersion','before','after']);check(historyJsonNumber(delta.schemaVersion,1));sourceImage(group,row,delta.after);
   const prior=['work_intervals','travel_legs','mileage_evidence'].includes(group)&&row.replaces_id!==null?maps[group].get(row.replaces_id as string):undefined;if(prior)sourceImage(group,prior,delta.before);else check(delta.before===null);
   const action=sequence==='1'?'create':group==='mileage_evidence'?'correct':row.change_kind;check(audit.action===action);
   if(operation.command_type===workBoundaryKind){
    check(group==='work_intervals'&&typeof row.operation_id==='string');
    const pair=boundaryRows.get(row.operation_id)??[];pair.push(row);boundaryRows.set(row.operation_id,pair);
   }
  }check(used.size===audits.size);
  for(const [id,operation] of operations)if(operation.command_type===workBoundaryKind){
   verifyWorkBoundarySource(operation,boundaryRows.get(id)??[],maps.work_intervals,boundaryAuditIds.get(id)??[]);
  }
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
