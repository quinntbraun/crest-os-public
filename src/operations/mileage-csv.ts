// Isolated server/export tooling. A scoped history page is not a complete
// Crest export/backup or proof that capture was authorized.
import {createHash} from 'node:crypto';
import {parseMileageHistoryPage,mileageEvidenceColumns,mileageAllocationColumns,mileageAuditColumns} from './mileage-history.ts';
import type {MileageHistoryPage} from './mileage-history.ts';
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex'),quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
export function formatMileageHistoryCsv(value:unknown,binding:Parameters<typeof parseMileageHistoryPage>[1]){
 const p=parseMileageHistoryPage(value,binding),snapshot=JSON.stringify(p)+'\n',snapshotToken=hash(snapshot),files:Record<string,string>={'mileage_history.json':snapshot};
 const tables={mileage_evidence:{columns:mileageEvidenceColumns,rows:p.evidence,jsonColumns:[]},leg_job_allocations:{columns:mileageAllocationColumns,rows:p.allocations,jsonColumns:[]},mileage_audits:{columns:mileageAuditColumns,rows:p.audits,jsonColumns:['delta']}} as const;
 const escapes:{entity:string;row_id:string;column:string;apostrophe_prefix:true}[]=[];
 for(const [entity,spec]of Object.entries(tables)){
  const rows=[...spec.rows].sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0),lines=[spec.columns.map(quote).join(',')];
  for(const row of rows)lines.push(spec.columns.map(column=>{
   const original=row[column];if(original===null)return quote('\\N');
   const json=(spec.jsonColumns as readonly string[]).includes(column);let text=(json?JSON.stringify(original):String(original)).replaceAll('\\','\\\\');
   if(text.startsWith("'")||['=','+','-','@'].includes(text.replace(/^\s+/,'')[0]??'')){text="'"+text;escapes.push({entity,row_id:String(row.id),column,apostrophe_prefix:true});}return quote(text);
  }).join(','));
  files[entity+'.csv']=lines.join('\r\n')+'\r\n';
 }
 files['mileage_escape_map.json']=JSON.stringify({schemaVersion:1,businessId:p.businessId,legId:p.legId,snapshotToken,escapes})+'\n';
 files['mileage_dictionary.json']=JSON.stringify({schemaVersion:1,scope:'mileage_history_page',tables:Object.fromEntries(Object.entries(tables).map(([entity,spec])=>[entity,{columns:spec.columns,jsonColumns:spec.jsonColumns}])),null:'\\N',csv:'UTF-8 RFC4180 CRLF',distances:'Exact numeric(14,4) miles; actual/estimated separate',fractions:'Exact numeric(12,8); physical leg counted once, unallocated/draft attribution is explicit',decode:'Parse CSV; unescaped \\N is null. Remove exactly the apostrophe specified by entity/row_id/column in the escape map, then unescape paired backslashes. Parse only listed JSON columns.',completeness:'Only the declared immutable mileage prefix page and its allocation/audit rows. Related trips/jobs/identity and other pages are external dependencies. Not complete Crest portability, accounting reports or backup.',noFinancialPosting:true})+'\n';
 if(Object.values(files).reduce((n,s)=>n+Buffer.byteLength(s),0)>16*1024*1024)throw Error('MILEAGE_EXPORT_TOO_LARGE');
 const manifest=JSON.stringify({schemaVersion:1,scope:'mileage_history_page',businessId:p.businessId,legId:p.legId,snapshotToken,afterVersion:p.afterVersion,throughVersion:p.throughVersion,hasMore:p.hasMore,nextAfterVersion:p.nextAfterVersion,counts:{evidence:p.evidence.length,allocations:p.allocations.length,audits:p.audits.length},completeCrestExport:false,completeBackup:false,parts:Object.entries(files).map(([name,content])=>({name,bytes:Buffer.byteLength(content),sha256:hash(content)}))})+'\n';
 return Object.freeze({page:p as MileageHistoryPage,files:Object.freeze(files),manifest});
}
