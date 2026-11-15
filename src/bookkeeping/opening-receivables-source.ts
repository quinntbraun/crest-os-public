import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseOpeningArStored} from './opening-receivables-schedule-contract.ts';

type Row=Readonly<Record<string,unknown>>;
type History=Readonly<{operation:readonly Row[];audit_event:readonly Row[]}>;
const save='finance.opening_ar.save';
const retire='finance.opening_ar.retire';
export const openingReceivablesSourceCoverage={table:'crest.opening_receivable_schedule_revisions',scope:'business',
 required:['id','business_id','worksheet_revision_id','revision','prior_revision','operation_id','audit_event_id','recorded_by',
  'recorded_at','evidence','evidence_sha256'],excluded:[],partialEvidenceGroup:null} as const;
export const openingReceivablesFile='opening_receivables_source.json';
export const isOpeningReceivablesOperation=(row:Row)=>row.command_type===save||row.command_type===retire;

function check(value:unknown):asserts value {
 if(!value)throw Error('OPENING_RECEIVABLES_SOURCE_REVIEW_REQUIRED');
}
function record(value:unknown):Row{
 check(value&&typeof value==='object'&&!Array.isArray(value));
 return value as Row;
}
function json(value:unknown):unknown{
 check(typeof value==='string'&&Buffer.byteLength(value)<=4194304);
 return JSON.parse(value);
}
function byOperation(rows:readonly Row[]){
 const index=new Map(rows.map(row=>[row.operation_id,row]));
 check(index.size===rows.length);
 return index;
}

export function verifyOpeningReceivablesSource(value:unknown,businessId:string,worksheet:unknown,history:History){
 check(exact(value,['schemaVersion','scope','businessId','revisions'])&&value.schemaVersion===1
  &&value.scope==='opening_receivables_source'&&value.businessId===businessId&&customerUuid(businessId)
  &&Array.isArray(value.revisions)&&value.revisions.length<=100);
 const parents=record(worksheet).revisions;
 check(Array.isArray(parents));
 const worksheets=new Map(parents.map(parent=>{
  const row=record(parent);
  return [row.id,row.cutoverOn];
 }));
 const operations=byOperation(history.operation.filter(isOpeningReceivablesOperation));
 const audits=byOperation(history.audit_event.filter(row=>operations.has(row.operation_id)));
 check(operations.size===audits.size);
 const latest=new Map<string,Row>();
 const saved=new Set<unknown>();
 for(const item of value.revisions){
  check(exact(item,['receipt','evidenceText']));
  const original=record(item.receipt);
  const parsed=parseOpeningArStored({schemaVersion:1,businessId,worksheetRevisionId:original.worksheetRevisionId,schedule:original},businessId);
  const receipt=parsed.schedule;
  check(receipt&&receipt.evidence.cutoverOn===worksheets.get(receipt.worksheetRevisionId)&&typeof item.evidenceText==='string');
  check(createHash('sha256').update(item.evidenceText).digest('hex')===original.evidenceSha256
   &&isDeepStrictEqual(json(item.evidenceText),original.evidence));
  const prior=latest.get(receipt.worksheetRevisionId)??null;
  check(BigInt(receipt.revision)===BigInt(prior?String(prior.revision):'0')+1n);
  const operation=operations.get(receipt.operationId),audit=audits.get(receipt.operationId);
  check(operation?.command_type===save&&operation.actor_id===receipt.recordedBy&&operation.state==='committed'
   &&!saved.has(receipt.operationId)&&isDeepStrictEqual(json(operation.result),original)
   &&audit&&audit.id===original.auditEventId&&audit.entity_kind==='opening_receivable_schedule_revisions'
   &&audit.entity_id===receipt.scheduleRevisionId&&String(audit.entity_version)===receipt.revision
   &&audit.actor_id===receipt.recordedBy&&audit.action==='review'&&audit.reason===receipt.evidence.reason
   &&isDeepStrictEqual(json(audit.delta),{schemaVersion:1,before:prior,after:original}));
  latest.set(receipt.worksheetRevisionId,original);
  saved.add(receipt.operationId);
 }
 for(const [id,operation] of operations){
  if(operation.command_type===save){check(saved.has(id));continue;}
  const decision=record(json(operation.result)),audit=audits.get(id);
  check(operation.state==='committed'&&decision.state==='retired'&&decision.businessId===businessId
   &&decision.operationId===id&&audit&&audit.id===decision.auditEventId&&audit.entity_kind==='operations'
   &&audit.entity_id===operation.id&&audit.actor_id===operation.actor_id&&audit.action==='retire'
   &&isDeepStrictEqual(json(audit.delta),{schemaVersion:1,before:null,after:decision}));
 }
}

export async function captureOpeningReceivablesSource(businessId:string,query:(sql:string,args:unknown[])=>Promise<unknown[]>){
 const rows=await query('SELECT crest_commands.opening_receivables_source_snapshot($1::uuid) AS result',[businessId]);
 check(rows.length===1&&exact(rows[0],['result']));
 return rows[0].result;
}
