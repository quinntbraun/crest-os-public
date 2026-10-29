// Compose existing source formats; do not create collection authority or a
// complete-business export claim from caller-supplied collections.
import {createHash} from 'node:crypto';
import {expenseCheck as check,expenseExact as exact} from './expense-contract.ts';
import {formatExpenseSourceCsv,expenseSourceTables} from './expense-source-csv.ts';
import {verifyBusinessFoundationEvidence} from '../../security/business-configuration-evidence.ts';
import {formatBusinessFoundationBundle} from '../../security/business-foundation-bundle.ts';
import {parseHistoryJson,historyJsonEqual} from '../../security/history-evidence-json.ts';
type Source=Parameters<typeof formatExpenseSourceCsv>[0];
type Input=Readonly<{source:Source;historySnapshotToken:string;configuration:string;identity:string;history:string}>;
type Row=Readonly<Record<string,unknown>>;
const digest=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');
const financialCommands=new Set(['bookkeeping.expense.save','bookkeeping.receipt.reserve','bookkeeping.receipt.publish']);
const financialEntities=new Set(['expense_revisions','expense_receipt_revisions']);
const equal=(serialized:unknown,value:unknown)=>typeof serialized==='string'&&historyJsonEqual(parseHistoryJson(serialized),parseHistoryJson(JSON.stringify(value)));
function projection(group:'expenses'|'receipts',r:Row){
 return group==='expenses'?{businessId:r.business_id,expenseId:r.expense_id,revision:r.revision,operationId:r.operation_id,actorId:r.actor_id,recordedAt:r.recorded_at,payload:r.payload}:{receiptVersion:r.revision,operationId:r.operation_id,actorId:r.actor_id,recordedAt:r.recorded_at,reservation:r.reservation,candidate:r.candidate};
}
export function formatExpenseSourceHistory(input:Input){
 check(exact(input,['source','historySnapshotToken','configuration','identity','history'])&&/^[a-f0-9]{64}$/.test(input.historySnapshotToken));
 const source=formatExpenseSourceCsv(input.source),businessId=input.source.businessId,foundation=verifyBusinessFoundationEvidence(input.configuration,input.identity,input.history,{businessId});
 check(foundation.history.context.snapshotToken===input.historySnapshotToken);
 const operations=new Map<string,Row>(),audits=new Map<string,Row>();
 for(const record of foundation.history.records){
  const row=JSON.parse(record.canonicalEvidence).row as Row;
  if(record.kind==='operation'&&financialCommands.has(String(row.command_type))){check(!operations.has(String(row.operation_id)));operations.set(String(row.operation_id),row);}
  if(record.kind==='audit_event'&&financialEntities.has(String(row.entity_kind))){const key=[row.entity_kind,row.entity_id,row.entity_version].join(':');check(!audits.has(key));audits.set(key,row);}
 }
 const sourceOperations=new Set<string>(),usedAudits=new Set<string>(),requiredActors=new Set<string>();
 for(const group of ['expenses','receipts'] as const){
  const spec=expenseSourceTables[group],rows=[...input.source.rows[group]].sort((a,b)=>String(a[spec.key[0]]).localeCompare(String(b[spec.key[0]]))||(BigInt(String(a.revision))<BigInt(String(b.revision))?-1:1)),prior=new Map<string,Row>();
  for(const row of rows){
   const operationId=String(row.operation_id),actor=String(row.actor_id),id=String(row[spec.key[0]]),auditKey=[spec.entity,id,row.revision].join(':'),operation=operations.get(operationId),audit=audits.get(auditKey),image=projection(group,row),before=prior.get(id),command=group==='expenses'?'bookkeeping.expense.save':row.revision==='1'?'bookkeeping.receipt.reserve':'bookkeeping.receipt.publish';
   check(!sourceOperations.has(operationId)&&operation&&audit&&operation.command_type===command&&operation.actor_id===actor&&operation.created_by===actor&&operation.origin==='manual'&&operation.import_row_id===null&&operation.state==='committed'&&operation.schema_version===1&&operation.result_schema_version===1);
   check(equal(operation.result,group==='expenses'?{schemaVersion:1,expense:image}:{schemaVersion:1,record:image}));
   const action=group==='expenses'?row.revision==='1'?'create':(row.payload as Record<string,unknown>).voided?'void':'correct':row.revision==='1'?'reserve':'publish';
   check(audit.operation_id===operationId&&audit.actor_id===actor&&audit.created_by===actor&&audit.origin==='manual'&&audit.import_row_id===null&&audit.action===action&&equal(audit.delta,{schemaVersion:1,before:before?projection(group,before):null,after:image}));
   sourceOperations.add(operationId);usedAudits.add(auditKey);requiredActors.add(actor);prior.set(id,row);
  }
 }
 check(sourceOperations.size===operations.size&&usedAudits.size===audits.size&&[...requiredActors].every(actor=>foundation.requiredActorIds.includes(actor)));
 const base=formatBusinessFoundationBundle({configuration:input.configuration,identity:input.identity,history:input.history},{businessId}).forServer();
 const parts=base.parts.map(p=>({name:p.name,content:p.content}));parts.push({name:'foundation_manifest.json',content:base.manifest});
 for(const group of ['expenses','receipts'] as const)for(const [kind,content]of Object.entries(source[group]))parts.push({name:expenseSourceTables[group].entity+(kind==='csv'?'.csv':kind==='escapeMap'?'_escape_map.json':'_dictionary.json'),content});
 parts.push({name:'expense_source_references.json',content:source.references},{name:'expense_source_manifest.json',content:source.manifest});
 check(new Set(parts.map(p=>p.name)).size===parts.length&&parts.reduce((n,p)=>n+Buffer.byteLength(p.content),0)<=64*1024*1024);
 const manifest=JSON.stringify({schemaVersion:1,scope:'owner_expense_history_sources',businessId,generationId:foundation.generationId,snapshotToken:input.source.snapshotToken,historySnapshotToken:input.historySnapshotToken,includedFinancialReferencesVerified:true,financialOperations:sourceOperations.size,financialAudits:usedAudits.size,requiredFinancialActorIds:[...requiredActors].sort(),parts:parts.map(({name,content})=>({name,bytes:Buffer.byteLength(content),sha256:digest(content)})),assurance:'supplied_source_consistency_only',consistentCaptureProven:false,referenceClosureComplete:false,completePortableExport:false,completeBackup:false})+'\n';
 check(parts.length<=1024&&Buffer.byteLength(manifest)+parts.reduce((n,p)=>n+Buffer.byteLength(p.content),0)<=64*1024*1024);
 return Object.freeze({manifest,parts:Object.freeze(parts.map(p=>Object.freeze(p)))});
}
