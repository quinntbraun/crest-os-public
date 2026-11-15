import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseStatementMatchDraftReceipt} from './statement-match-draft-contract.ts';

type Row=Readonly<Record<string,unknown>>;
type History=Readonly<{operation:readonly Row[];audit_event:readonly Row[]}>;
const command='finance.statement_match_draft.save';
const entity='statement_match_draft_revisions';
export const statementMatchDraftFile='statement_match_draft_source.json';
export const statementMatchDraftSourceCoverage={table:'crest.statement_match_draft_revisions',scope:'business',
 required:['business_id','statement_id','revision','previous_revision','operation_id','audit_id','recorded_by',
  'recorded_at','movement_from_on','reason','allocations'],excluded:[],partialEvidenceGroup:null} as const;
export const isStatementMatchDraftOperation=(row:Row)=>row.command_type===command;
function check(value:unknown):asserts value{
 if(!value)throw Error('STATEMENT_MATCH_DRAFT_EXPORT_REQUIRED');
}
function json(value:unknown){
 check(typeof value==='string'&&Buffer.byteLength(value)<=4194304);
 return JSON.parse(value) as unknown;
}

export function verifyStatementMatchDraftSource(value:unknown,businessId:string,staged:unknown,history:History){
 check(exact(value,['schemaVersion','scope','businessId','revisions'])&&value.schemaVersion===1
  &&value.scope==='statement_match_draft_source'&&value.businessId===businessId&&customerUuid(businessId)
  &&Array.isArray(value.revisions)&&value.revisions.length<=100&&Buffer.byteLength(JSON.stringify(value))<=4194304);
 check(exact(staged,['schemaVersion','scope','businessId','batches'])&&staged.businessId===businessId&&Array.isArray(staged.batches));
 const parents=new Set(staged.batches.map((row:Row)=>row.id));
 const saved=history.operation.filter(isStatementMatchDraftOperation);
 const reviewed=history.audit_event.filter(row=>row.entity_kind===entity);
 const operations=new Map(saved.map(row=>[row.operation_id,row]));
 const audits=new Map(reviewed.map(row=>[row.operation_id,row]));
 check(operations.size===saved.length&&audits.size===reviewed.length&&operations.size===audits.size
  &&operations.size===value.revisions.length);
 const latest=new Map<string,ReturnType<typeof parseStatementMatchDraftReceipt>>();
 for(const entry of value.revisions){
  check(exact(entry,['receipt','auditId'])&&customerUuid(entry.auditId)
   &&entry.receipt&&typeof entry.receipt==='object'&&'statementId' in entry.receipt&&customerUuid(entry.receipt.statementId)
   &&parents.has(entry.receipt.statementId));
  const receipt=parseStatementMatchDraftReceipt(entry.receipt,businessId,entry.receipt.statementId);
  const prior=latest.get(receipt.statementId)??null;
  check(BigInt(receipt.revision)===BigInt(prior?.revision??'0')+1n);
  const operation=operations.get(receipt.operationId),audit=audits.get(receipt.operationId);
  check(operation&&audit&&operation.business_id===businessId&&operation.actor_id===receipt.recordedBy
   &&operation.state==='committed'&&operation.origin==='manual'&&String(operation.result_schema_version)==='1'
   &&isDeepStrictEqual(json(operation.result),receipt)&&audit.id===entry.auditId&&audit.business_id===businessId
   &&audit.actor_id===receipt.recordedBy&&audit.entity_id===receipt.statementId&&String(audit.entity_version)===receipt.revision
   &&audit.action==='review'&&audit.reason===receipt.reason&&typeof audit.hash_input==='string'&&audit.hash_input===audit.payload
   &&createHash('sha256').update(audit.hash_input).digest('hex')===audit.event_hash);
  const delta={schemaVersion:1,before:prior,after:receipt};
  const payload=json(audit.payload);
  check(isDeepStrictEqual(json(audit.delta),delta)&&payload&&typeof payload==='object'&&'delta' in payload
   &&isDeepStrictEqual(payload.delta,delta)&&'operationId' in payload&&payload.operationId===receipt.operationId);
  latest.set(receipt.statementId,receipt);
  operations.delete(receipt.operationId);
  audits.delete(receipt.operationId);
 }
 check(!operations.size&&!audits.size);
}

export async function captureStatementMatchDraftSource(businessId:string,query:(sql:string,args:unknown[])=>Promise<unknown[]>){
 const rows=await query('SELECT crest_commands.statement_match_draft_source_snapshot($1::uuid) AS result',[businessId]);
 check(rows.length===1&&exact(rows[0],['result']));
 return rows[0].result;
}
