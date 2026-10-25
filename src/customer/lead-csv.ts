// Partial source extraction only. Caller owns one authorized repeatable-read
// snapshot; formatting grants neither capture nor private-download authority.
import {createHash} from 'node:crypto';
import {leadColumns,leadSourceColumns,parseLead,parseLeadSource} from './lead-contract.ts';
import type {Lead,LeadSource} from './lead-contract.ts';
import {leadEventColumns,parseLeadEvent} from './lead-state-contract.ts';
import type {LeadEvent} from './lead-state-contract.ts';
import {customerUuid,requireCustomer} from './customer-contract.ts';
type Snapshot<T>=Readonly<{businessId:string;snapshotToken:string;expectedRowCount:string;rows:readonly T[]}>;
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function format<T extends {id:string}>(input:Snapshot<T>,columns:readonly (keyof T&string)[],parse:(row:unknown,businessId:string)=>T,entity:'leads'|'lead_sources'|'lead_events',scope:string){
  requireCustomer(customerUuid(input.businessId)&&typeof input.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(input.snapshotToken)&&typeof input.expectedRowCount==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(input.expectedRowCount)&&Number(input.expectedRowCount)<=1000&&Array.isArray(input.rows)&&input.rows.length===Number(input.expectedRowCount));
  const businessId=input.businessId,snapshotToken=input.snapshotToken,rows=Array.from(input.rows,r=>parse(r,businessId)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  requireCustomer(new Set(rows.map(r=>r.id)).size===rows.length);
  const escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[],lines=[columns.map(quote).join(',')];let bytes=Buffer.byteLength(lines[0]!)+2;
  for(const row of rows){const cells=columns.map(column=>{
    const original=row[column];if(original===null)return quote('\\N');
    const scalar=typeof original==='object'?JSON.stringify(original):String(original);let value=scalar.replaceAll('\\','\\\\');
    if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(value.replace(/^\s+/,'')[0]??''))){value="'"+value;escapes.push({row_id:row.id,column,apostrophe_prefix:true});}
    return quote(value);
  });const line=cells.join(',');bytes+=Buffer.byteLength(line)+2;requireCustomer(bytes<=8*1024*1024);lines.push(line);}
  const csv=lines.join('\r\n')+'\r\n',escapeMap=JSON.stringify({schemaVersion:1,entity,businessId,snapshotToken,escapes})+'\n';
  const dictionary=JSON.stringify({schemaVersion:1,entity,columns,null:'\\N',csv:'UTF-8 RFC4180 CRLF',scalarTypes:{...(entity==='lead_events'?{lead_version:'exact resulting lead version decimal string',from_state:'original canonical lead state',to_state:'manual target state; never an inferred commercial outcome',reason:'nullable original meaningful text',effective_at:'server-recorded UTC instant with microseconds',quote_send_id:'null; genuine commercial source integration is not implemented',acceptance_id:'null; genuine commercial source integration is not implemented'}:{}),version:'exact decimal string',estimated_cents:'nullable exact decimal string; null is unknown, zero is explicit',source_snapshot:'nullable JSON object containing the retained15-column source snapshot; parse JSON after CSV/text decoding',active:'boolean true/false',created_at:'UTC instant with microseconds',updated_at:'UTC instant with microseconds',follow_up_at:'nullable UTC instant with microseconds'},decode:'Parse CSV; unescaped \\N is null; remove exactly the apostrophe indicated by escape_map for that row/column; unescape paired backslashes. Parse declared JSON and boolean columns; retain bigint cents/versions and UTC instants as strings. Never infer an escape from appearance.',completeness:entity==='lead_events'?'Immutable manual lead-event source columns only; not a complete Crest export or backup.':'Current lead or source columns only; not a complete Crest export or backup.'})+'\n';
  const manifest=JSON.stringify({schemaVersion:1,scope,businessId,snapshotToken,rowCount:String(rows.length),completeCrestExport:false,completeBackup:false,parts:[[entity+'.csv',csv],[entity+'_escape_map.json',escapeMap],[entity+'_dictionary.json',dictionary]].map(([name,content])=>({name,bytes:Buffer.byteLength(content!),sha256:hash(content!)}))})+'\n';
  return Object.freeze({csv,escapeMap,dictionary,manifest});
}
export function formatLeadCsv(input:Snapshot<Lead>){return format(input,leadColumns,parseLead,'leads','lead_directory');}
export function formatLeadSourceCsv(input:Snapshot<LeadSource>){return format(input,leadSourceColumns,parseLeadSource,'lead_sources','lead_source_directory');}
export function formatLeadEventCsv(input:Snapshot<LeadEvent>){return format(input,leadEventColumns,parseLeadEvent,'lead_events','lead_state_events');}
