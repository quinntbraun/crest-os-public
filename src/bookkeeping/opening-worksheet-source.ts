import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseOpeningReceipt} from './opening-worksheet-contract.ts';
import type {OpeningReceipt} from './opening-worksheet-contract.ts';

export const openingWorksheetSourceCoverage={
 table:'crest.opening_worksheet_revisions',scope:'business',
 required:['id','business_id','revision','prior_revision','cutover_on','cutover_at','time_zone','operation_id','audit_event_id',
  'recorded_by','recorded_at','evidence','evidence_sha256'],excluded:[],partialEvidenceGroup:null,
};
const revisionFields=['id','businessId','revision','priorRevision','cutoverOn','cutoverAt','timeZone','operationId','auditEventId',
 'recordedBy','recordedAt','evidence','evidenceSha256'] as const;
const operationFields=['id','businessId','operationId','actorId','commandType','schemaVersion','recoveryEpoch','payloadHash','state',
 'resultSchemaVersion','result','committedAt','createdAt','createdBy','origin','importRowId'] as const;
const auditFields=['id','businessId','operationId','actorId','entityKind','entityId','entityVersion','action','reason','effectiveAt',
 'delta','createdAt','recordedAt','createdBy','origin','importRowId','databasePrincipal','payload','hashInput','eventHash'] as const;
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const scope='opening_worksheet_source';
const save='finance.opening_worksheet.save';
const retire='finance.opening_worksheet.retire';

function check(condition:unknown):asserts condition{
 if(!condition)throw Error('OPENING_WORKSHEET_SOURCE_REVIEW_REQUIRED');
}
function json(text:unknown){
 check(typeof text==='string'&&Buffer.byteLength(text)<=262144);
 return JSON.parse(text) as unknown;
}
function history(value:unknown,businessId:string,limit:number){
 check(Array.isArray(value)&&value.length<=limit);
 let cursor='';
 return value.map((row:unknown)=>{
  check(row!==null&&typeof row==='object'&&!Array.isArray(row)&&'businessId' in row&&row.businessId===businessId&&
   'operationId' in row&&customerUuid(row.operationId)&&row.operationId>cursor&&'id' in row&&customerUuid(row.id));
  cursor=row.operationId;
  return row as Record<string,unknown>&{operationId:string;id:string};
 });
}

export function verifyOpeningWorksheetSource(value:unknown,businessId:string){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','scope','businessId','revisions','operations','audits'])
   &&value.schemaVersion===1&&value.scope===scope&&value.businessId===businessId&&Buffer.byteLength(JSON.stringify(value))<=4194304);
 const operations=history(value.operations,businessId,200);
 const audits=history(value.audits,businessId,200);
 const auditsByOperation=new Map(audits.map(row=>[row.operationId,row]));
 check(operations.length===audits.length&&Array.isArray(value.revisions)&&value.revisions.length<=100);
 const saveOperations=new Map(operations.filter(row=>row.commandType===save).map(row=>[row.operationId,row]));
 check(saveOperations.size===value.revisions.length);

 let previous:OpeningReceipt|null=null;
 const revisions=value.revisions.map((row:unknown,index)=>{
  check(exact(row,revisionFields)&&row.businessId===businessId&&row.revision===String(index+1)
   &&row.priorRevision===(index===0?null:String(index))&&customerUuid(row.operationId)
   &&typeof row.evidence==='string'&&hash(row.evidenceSha256)&&sha(row.evidence)===row.evidenceSha256);
  const evidence=json(row.evidence);
  check(evidence!==null&&typeof evidence==='object'&&!Array.isArray(evidence));
  const fields=evidence as Record<string,unknown>;
  check(fields.cutoverOn===row.cutoverOn&&fields.cutoverAt===row.cutoverAt&&fields.timeZone===row.timeZone);
  const receipt=parseOpeningReceipt({...fields,schemaVersion:1,businessId,worksheetRevisionId:row.id,revision:row.revision,
   operationId:row.operationId,auditEventId:row.auditEventId,recordedBy:row.recordedBy,recordedAt:row.recordedAt,
   evidenceSha256:row.evidenceSha256},businessId);
  const operation=saveOperations.get(receipt.operationId),audit=auditsByOperation.get(receipt.operationId);
  check(operation&&audit&&isDeepStrictEqual(json(operation.result),receipt)&&operation.actorId===receipt.recordedBy
   &&audit.id===receipt.auditEventId&&audit.actorId===receipt.recordedBy&&audit.entityId===receipt.worksheetRevisionId
   &&audit.entityVersion===receipt.revision&&audit.entityKind==='opening_worksheet_revisions'&&audit.action==='review'
   &&audit.reason===receipt.equityBasis&&isDeepStrictEqual(json(audit.delta),{schemaVersion:1,before:previous,after:receipt}));
  saveOperations.delete(receipt.operationId);
  previous=receipt;
  return receipt;
 });
 for(const operation of operations){
  check(exact(operation,operationFields)&&customerUuid(operation.actorId)&&operation.createdBy===operation.actorId&&
   customerUuid(operation.recoveryEpoch)&&hash(operation.payloadHash)&&operation.schemaVersion===1&&operation.resultSchemaVersion===1
   &&operation.state==='committed'&&operation.origin==='manual'&&operation.importRowId===null
   &&customerInstant(operation.createdAt)&&customerInstant(operation.committedAt)&&operation.committedAt>=operation.createdAt
   &&(operation.commandType===save||operation.commandType===retire));
  const audit=auditsByOperation.get(operation.operationId);
  check(audit&&exact(audit,auditFields)&&audit.actorId===operation.actorId&&audit.createdBy===operation.actorId
   &&customerUuid(audit.entityId)&&typeof audit.reason==='string'&&audit.reason.length>0&&audit.origin==='manual'
   &&audit.importRowId===null&&audit.effectiveAt===null&&customerInstant(audit.recordedAt)&&audit.createdAt===audit.recordedAt
   &&audit.recordedAt>=operation.createdAt&&audit.recordedAt<=operation.committedAt&&audit.payload===audit.hashInput
   &&typeof audit.hashInput==='string'&&hash(audit.eventHash)&&sha(audit.hashInput)===audit.eventHash
   &&typeof audit.databasePrincipal==='string'&&audit.databasePrincipal.length>0);
  const delta=json(audit.delta);
  check(isDeepStrictEqual(json(audit.payload),{schemaVersion:1,hashFormat:'pg17-jsonb-text-utf8-v1',id:audit.id,
   businessId,operationId:operation.operationId,actorId:audit.actorId,createdBy:audit.createdBy,entityKind:audit.entityKind,
   entityId:audit.entityId,entityVersion:audit.entityVersion,action:audit.action,reason:audit.reason,delta,origin:audit.origin,
   importRowId:null,databasePrincipal:audit.databasePrincipal,recordedAt:audit.recordedAt,effectiveAt:null}));
  if(operation.commandType===retire){
   const decision=json(operation.result);
   check(exact(decision,['schemaVersion','state','businessId','operationId','originalEpoch','auditEventId','reviewEpoch'])&&
    decision.state==='retired'&&decision.schemaVersion===1&&decision.businessId===businessId&&decision.operationId===operation.operationId&&
    customerUuid(decision.originalEpoch)&&decision.reviewEpoch===operation.recoveryEpoch&&decision.auditEventId===audit.id&&
    audit.entityKind==='operations'&&audit.entityId===operation.id&&audit.entityVersion==='1'&&audit.action==='retire'&&
    isDeepStrictEqual(delta,{schemaVersion:1,before:null,after:decision}));
  }
 }
 return {revisions:revisions.length,operations:operations.length,audits:audits.length};
}

export async function captureOpeningWorksheetSource(businessId:string,query:(sql:string,args:unknown[])=>Promise<unknown[]>){
 const rows=await query('SELECT crest_commands.opening_worksheet_source_snapshot($1::uuid) AS result',[businessId]);
 check(rows.length===1&&exact(rows[0],['result']));
 const source=rows[0].result;
 verifyOpeningWorksheetSource(source,businessId);
 return JSON.stringify(source)+'\n';
}

type Row=Readonly<Record<string,unknown>>;
function verifyHistorySet(portable:Row[],global:Row[]){
 check(portable.length===global.length&&new Set(global.map(row=>row.id)).size===global.length);
 const globalById=new Map(global.map(row=>[row.id,row]));
 for(const item of portable){
  const row=globalById.get(item.id);
  check(row);
  for(const [key,value] of Object.entries(item)){
   const name=key.replace(/[A-Z]/g,letter=>'_'+letter.toLowerCase());
   const saved=row[name];
   if(key.endsWith('At')&&value!==null){
    // Generic history uses PostgreSQL's ISO offset form and omits trailing
    // fractional zeros. Compare the exact six digits, never Date milliseconds.
    check(typeof saved==='string'&&typeof value==='string');
    const instant=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?\+00:00$/.exec(saved);
    check(instant&&instant[1]+'.'+(instant[2]??'').padEnd(6,'0')+'Z'===value);
   }else if(key==='schemaVersion'||key==='resultSchemaVersion'){
    check(String(saved)===String(value));
   }else check(saved===value);
  }
 }
}
export function verifyOpeningWorksheetBusinessHistory(value:unknown,businessId:string,global:Readonly<{
 operation:readonly Row[];audit_event:readonly Row[];
}>){
 const counts=verifyOpeningWorksheetSource(value,businessId);
 const source=value as {operations:Row[];audits:Row[]};
 const operations=global.operation.filter(row=>row.command_type===save||row.command_type===retire);
 const ids=new Set(operations.map(row=>row.operation_id));
 verifyHistorySet(source.operations,operations);
 verifyHistorySet(source.audits,global.audit_event.filter(row=>ids.has(row.operation_id)));
 return counts;
}
