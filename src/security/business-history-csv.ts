import {createHash} from 'node:crypto';
import {verifyBusinessHistoryEvidence} from './business-history-evidence.ts';

const operationColumns=Object.freeze(['id','business_id','operation_id','actor_id','command_type','schema_version','recovery_epoch','payload_hash','state','result_schema_version','result','committed_at','created_at','created_by','origin','import_row_id']);
const auditColumns=Object.freeze(['id','business_id','operation_id','actor_id','entity_kind','entity_id','entity_version','action','reason','effective_at','delta','created_at','recorded_at','created_by','origin','import_row_id','database_principal','payload','hash_input','event_hash']);
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
export class BusinessHistoryCsvError extends Error{constructor(){super('BUSINESS_HISTORY_CSV_REVIEW_REQUIRED');this.name='BusinessHistoryCsvError';}}

// Formatting only: preserve all existing operation/audit source columns and
// nested JSON text without Number round-trips. Capture, authorization, private
// delivery, actor closure and recoverable custody remain separate requirements.
export function formatBusinessHistoryCsv(serialized:unknown,expected:{businessId:string}){
 try{
  const verified=verifyBusinessHistoryEvidence(serialized,expected),{businessId,snapshotToken,observedAt}=verified.context;
  let totalBytes=0;
  function serialize(kind:'operation'|'audit_event',entity:string,columns:readonly string[]){
   const records=verified.records.filter(row=>row.kind===kind),escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[];
   const lines=[columns.map(quote).join(',')];totalBytes+=Buffer.byteLength(lines[0]!)+2;
   for(const item of records){
    // The existing verifier requires every projected column and a scalar
    // number only for bounded schema integers. Exact bigint versions and all
    // nested result/delta/payload JSON have already remained strings.
    const row=JSON.parse(item.canonicalEvidence).row as Record<string,unknown>;
    const line=columns.map(column=>{
     const original=row[column];if(original===null)return quote('\\N');
     if(typeof original!=='string'&&typeof original!=='number')throw new BusinessHistoryCsvError();
     let value=String(original).replaceAll('\\','\\\\');
     if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(value.replace(/^\s+/,'')[0]??''))){value="'"+value;escapes.push({row_id:item.recordId,column,apostrophe_prefix:true});}
     return quote(value);
    }).join(',');
    totalBytes+=Buffer.byteLength(line)+2;if(totalBytes>16*1024*1024)throw new BusinessHistoryCsvError();lines.push(line);
   }
   const csv=lines.join('\r\n')+'\r\n';
   const escapeMap=JSON.stringify({schemaVersion:1,entity,businessId,snapshotToken,escapes})+'\n';
   const dictionary=JSON.stringify({schemaVersion:1,entity,columns,null:'\\N',csv:'UTF-8 RFC4180 CRLF',jsonTextColumns:kind==='operation'?['result']:['delta','payload'],exactTextColumns:kind==='operation'?[]:['entity_version'],instants:'Original UTC microsecond text; do not pass through Date or spreadsheet date conversion',decode:'Parse CSV. Unescaped \\N is null. Remove exactly the apostrophe indicated by this entity escape_map for that row and column, then unescape paired backslashes. JSON text columns remain original text; parse only with exact numeric handling. Numeric schema columns are bounded integers. All UUIDs, hashes, instants and entity_version remain text.',completeness:'All current operation or audit columns in the supplied verified history collection. Caller-provided counts and hashes establish internal consistency only; capture authorization, actor closure, complete Crest export and backup are not established.'})+'\n';
   return Object.freeze({csv,escapeMap,dictionary});
  }
  const operations=serialize('operation','operations',operationColumns),audits=serialize('audit_event','audit_events',auditColumns);
  const parts=[...Object.entries(operations).map(([kind,content])=>({name:'operations'+(kind==='csv'?'.csv':kind==='escapeMap'?'_escape_map.json':'_dictionary.json'),content})),...Object.entries(audits).map(([kind,content])=>({name:'audit_events'+(kind==='csv'?'.csv':kind==='escapeMap'?'_escape_map.json':'_dictionary.json'),content}))];
  const manifest=JSON.stringify({schemaVersion:1,scope:'business_history',generationId:verified.generationId,businessId,snapshotToken,observedAt,recordCounts:verified.context.recordCounts,assurance:'internal_consistency_only',referenceClosureComplete:false,completePortableExport:false,completeBackup:false,requiredActorIds:verified.requiredActorIds,parts:parts.map(({name,content})=>({name,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')}))})+'\n';
  return Object.freeze({operations,audits,manifest});
 }catch{throw new BusinessHistoryCsvError();}
}
