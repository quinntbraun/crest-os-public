import {mileageEvidenceColumns,mileageAllocationColumns,mileageAuditColumns} from './mileage-history.ts';
import type {MileageHistoryPage} from './mileage-history.ts';

const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
export const mileageExportByteLimit=16*1024*1024;
type Part=Readonly<{name:string;bytes:number;sha256:string}>;

export function mileageExportFiles(page:MileageHistoryPage,snapshot:string,snapshotToken:string){
 const files:Record<string,string>={'mileage_history.json':snapshot};
 const tables={
  mileage_evidence:{columns:mileageEvidenceColumns,rows:page.evidence,jsonColumns:[]},
  leg_job_allocations:{columns:mileageAllocationColumns,rows:page.allocations,jsonColumns:[]},
  mileage_audits:{columns:mileageAuditColumns,rows:page.audits,jsonColumns:['delta']}
 } as const;
 const escapes:{entity:string;row_id:string;column:string;apostrophe_prefix:true}[]=[];
 for(const [entity,spec]of Object.entries(tables)){
  const rows=[...spec.rows].sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);
  const lines=[spec.columns.map(quote).join(',')];
  for(const row of rows)lines.push(spec.columns.map(column=>{
   const original=row[column];if(original===null)return quote('\\N');
   const json=(spec.jsonColumns as readonly string[]).includes(column);
   let text=(json?JSON.stringify(original):String(original)).replaceAll('\\','\\\\');
   if(text.startsWith("'")||['=','+','-','@'].includes(text.replace(/^\s+/,'')[0]??'')){
    text="'"+text;escapes.push({entity,row_id:String(row.id),column,apostrophe_prefix:true});
   }
   return quote(text);
  }).join(','));
  files[entity+'.csv']=lines.join('\r\n')+'\r\n';
 }
 files['mileage_escape_map.json']=JSON.stringify({schemaVersion:1,businessId:page.businessId,legId:page.legId,snapshotToken,escapes})+'\n';
 files['mileage_dictionary.json']=JSON.stringify({schemaVersion:1,scope:'mileage_history_page',tables:Object.fromEntries(Object.entries(tables).map(([name,spec])=>[name,{columns:spec.columns,jsonColumns:spec.jsonColumns}])),null:'\\N',csv:'UTF-8 RFC4180 CRLF',distances:'Exact numeric(14,4) miles; actual/estimated separate',fractions:'Exact numeric(12,8); physical leg counted once, unallocated/draft attribution is explicit',decode:'Parse CSV; unescaped \\N is null. Remove exactly the apostrophe specified by entity/row_id/column in the escape map, then unescape paired backslashes. Parse only listed JSON columns.',completeness:'Only the declared immutable mileage prefix page and its allocation/audit rows. Related trips/jobs/identity and other pages are external dependencies. Not complete Crest portability, accounting reports or backup.',noFinancialPosting:true})+'\n';
 return Object.freeze(files);
}

export function mileageExportManifest(page:MileageHistoryPage,snapshotToken:string,parts:readonly Part[]){
 return JSON.stringify({schemaVersion:1,scope:'mileage_history_page',businessId:page.businessId,legId:page.legId,snapshotToken,
  afterVersion:page.afterVersion,throughVersion:page.throughVersion,hasMore:page.hasMore,nextAfterVersion:page.nextAfterVersion,
  counts:{evidence:page.evidence.length,allocations:page.allocations.length,audits:page.audits.length},
  completeCrestExport:false,completeBackup:false,parts})+'\n';
}
