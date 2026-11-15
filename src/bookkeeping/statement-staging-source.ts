import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerDate,customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {moneyChannelCents} from './finance-money-channel-contract.ts';
import {assessStatementRows} from './statement-reconciliation.ts';

export const statementSourceCoverage=[
 {table:'crest.statement_imports',scope:'business',excluded:[],partialEvidenceGroup:null,required:[
  'id','business_id','account_id','channel_version_id','starts_on','ends_on','opening_cents','closing_cents','file_sha256',
  'date_convention','completeness_evidence','row_count','signed_rows_cents','rows_sha256','statement_difference_cents',
  'operation_id','created_by','created_at',
 ]},
 {table:'crest.statement_import_rows',scope:'business',excluded:[],partialEvidenceGroup:null,required:[
  'business_id','statement_id','id','statement_on','signed_cents',
 ]},
] as const;
export const statementStagingFile='statement_staging_source.json';
const batchFields=['id','businessId','accountId','channelVersionId','startsOn','endsOn','openingCents','closingCents','fileSha256',
 'dateConvention','completenessEvidence','rowCount','signedRowsCents','rowsSha256','statementDifferenceCents','operationId',
 'recordedBy','recordedAt','rows'] as const;
const command='finance.statement.stage';
export const isStatementStagingOperation=(row:Row)=>row.command_type===command;
const scope='statement_staging_source';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
type Row=Readonly<Record<string,unknown>>;
type History=Readonly<{operation:readonly Row[];audit_event:readonly Row[]}>;
function check(valid:unknown):asserts valid {
 if(!valid)throw Error('STATEMENT_STAGING_SOURCE_REVIEW_REQUIRED');
}
function json(value:unknown){
 check(typeof value==='string'&&Buffer.byteLength(value)<=4194304);
 return JSON.parse(value) as unknown;
}

export function verifyStatementStagingBusinessHistory(value:unknown,businessId:string,history:History){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','scope','businessId','batches'])
  &&value.schemaVersion===1&&value.scope===scope&&value.businessId===businessId&&Array.isArray(value.batches)
  &&value.batches.length<=200&&Buffer.byteLength(JSON.stringify(value))<=4194304);
 const operations=history.operation.filter(isStatementStagingOperation);
 const audits=history.audit_event.filter(row=>row.entity_kind==='statement_imports');
 const operationsById=new Map(operations.map(row=>[row.operation_id,row]));
 const auditsById=new Map(audits.map(row=>[row.operation_id,row]));
 check(operationsById.size===operations.length&&auditsById.size===audits.length
  &&operations.length===audits.length&&operations.length===value.batches.length);
 let order='',totalRows=0;
 const retainedFiles=new Set<string>();
 for(const batch of value.batches as unknown[]){
  check(exact(batch,batchFields)&&customerUuid(batch.id)&&batch.id>order&&batch.businessId===businessId
   &&customerUuid(batch.accountId)&&customerUuid(batch.channelVersionId)&&customerUuid(batch.operationId)&&customerUuid(batch.recordedBy)
   &&customerInstant(batch.recordedAt)&&customerDate(batch.startsOn)&&customerDate(batch.endsOn)
   &&moneyChannelCents(batch.openingCents)&&moneyChannelCents(batch.closingCents)
   &&financeAccountReviewReason(batch.dateConvention)&&financeAccountReviewReason(batch.completenessEvidence)
   &&hash(batch.fileSha256)&&hash(batch.rowsSha256)&&typeof batch.rows==='string'&&sha(batch.rows)===batch.rowsSha256);
  order=batch.id;
  const file=batch.accountId+':'+batch.fileSha256;
  check(!retainedFiles.has(file));
  retainedFiles.add(file);
  const rows=json(batch.rows);
  check(Array.isArray(rows)&&rows.length===batch.rowCount);
  totalRows+=rows.length;
  check(totalRows<=10000);
  let rowOrder='';
  for(const row of rows as unknown[]){
   check(exact(row,['id','statementOn','signedCents'])&&customerUuid(row.id)&&row.id>rowOrder);
   rowOrder=row.id;
  }
  const {rowTotal,difference}=assessStatementRows({startsOn:batch.startsOn,endsOn:batch.endsOn,
   openingCents:batch.openingCents,closingCents:batch.closingCents},rows);
  check(String(rowTotal)===batch.signedRowsCents&&String(difference)===batch.statementDifferenceCents);
  const operation=operationsById.get(batch.operationId),audit=auditsById.get(batch.operationId);
  check(operation&&audit&&operation.business_id===businessId&&audit.business_id===businessId
   &&operation.actor_id===batch.recordedBy&&audit.actor_id===batch.recordedBy
   &&operation.origin==='manual'&&operation.import_row_id===null&&operation.state==='committed'
   &&String(operation.schema_version)==='1'&&String(operation.result_schema_version)==='1'
   &&audit.action==='stage'&&audit.entity_id===batch.id&&String(audit.entity_version)==='1'
   &&typeof audit.hash_input==='string'&&audit.hash_input===audit.payload&&hash(audit.event_hash)&&sha(audit.hash_input)===audit.event_hash);
  const receipt={schemaVersion:1,businessId,statementId:batch.id,accountId:batch.accountId,channelVersionId:batch.channelVersionId,
   operationId:batch.operationId,startsOn:batch.startsOn,endsOn:batch.endsOn,openingCents:batch.openingCents,
   closingCents:batch.closingCents,fileSha256:batch.fileSha256,dateConvention:batch.dateConvention,
   completenessEvidence:batch.completenessEvidence,rowCount:batch.rowCount,signedRowsCents:batch.signedRowsCents,
   statementDifferenceCents:batch.statementDifferenceCents,rowsSha256:batch.rowsSha256};
  const delta={schemaVersion:1,before:null,after:receipt};
  const payload=json(audit.payload);
  check(isDeepStrictEqual(json(operation.result),receipt)&&isDeepStrictEqual(json(audit.delta),delta)
   &&payload!==null&&typeof payload==='object'&&'delta' in payload&&isDeepStrictEqual(payload.delta,delta)
   &&'entityId' in payload&&payload.entityId===batch.id&&'operationId' in payload&&payload.operationId===batch.operationId);
  operationsById.delete(batch.operationId);
  auditsById.delete(batch.operationId);
 }
 check(operationsById.size===0&&auditsById.size===0);
 return {batches:value.batches.length,rows:totalRows};
}

export async function captureStatementStagingSource(businessId:string,query:(sql:string,args:unknown[])=>Promise<unknown[]>){
 const result=await query('SELECT crest_commands.statement_staging_source_snapshot($1::uuid) AS result',[businessId]);
 check(result.length===1&&exact(result[0],['result']));
 return result[0].result;
}
