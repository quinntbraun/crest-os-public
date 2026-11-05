// Private retained source rows, separate from period-based accountant totals.
// Formatting establishes internal consistency, not capture authority or custody.
import {createHash} from 'node:crypto';
import {expenseCheck as check,expenseExact as exact,expenseId,expenseHistory} from './expense-contract.ts';
import {expenseReceiptSources} from './receipt-export.ts';
export const expenseSourceTables={
 expenses:{entity:'expense_revisions',columns:['business_id','expense_id','revision','operation_id','actor_id','recorded_at','payload'],key:['expense_id','revision'],json:['payload']},
 receipts:{entity:'expense_receipt_revisions',columns:['business_id','receipt_id','revision','expense_id','expense_revision','operation_id','actor_id','recorded_at','reservation','candidate'],key:['receipt_id','revision'],json:['reservation','candidate']}
} as const;
type Group=keyof typeof expenseSourceTables;
type Row=Readonly<Record<string,unknown>>;
type Input=Readonly<{businessId:string;snapshotToken:string;commercialSnapshotToken:string;expectedCounts:Readonly<Record<Group,string>>;rows:Readonly<Record<Group,readonly Row[]>>}>;
const groups=['expenses','receipts'] as const,hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex'),quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
export function formatExpenseSourceCsv(input:Input){
 check(exact(input,['businessId','snapshotToken','commercialSnapshotToken','expectedCounts','rows'])&&expenseId(input.businessId)&&/^[a-f0-9]{64}$/.test(input.snapshotToken)&&/^[a-f0-9]{64}$/.test(input.commercialSnapshotToken)&&exact(input.expectedCounts,groups)&&exact(input.rows,groups));
 const rows={} as Record<Group,Row[]>;
 for(const group of groups){
  const spec=expenseSourceTables[group],source=input.rows[group],count=input.expectedCounts[group];check(Array.isArray(source)&&/^(0|[1-9][0-9]{0,4})$/.test(count)&&Number(count)<=10000&&source.length===Number(count));
  for(const r of source)check(exact(r,spec.columns)&&r.business_id===input.businessId);
  rows[group]=[...source].sort((a,b)=>String(a[spec.key[0]]).localeCompare(String(b[spec.key[0]]))||(BigInt(String(a.revision))<BigInt(String(b.revision))?-1:1));
 }
 const expenses=rows.expenses.map(r=>({businessId:r.business_id,expenseId:r.expense_id,revision:r.revision,operationId:r.operation_id,actorId:r.actor_id,recordedAt:r.recorded_at,payload:r.payload}));
 const history=expenseHistory(expenses,input.businessId);
 const receipts=rows.receipts.map(r=>{check(r.reservation&&typeof r.reservation==='object');const reservation=r.reservation as Record<string,unknown>;check(reservation.businessId===r.business_id&&reservation.receiptId===r.receipt_id&&reservation.expenseId===r.expense_id&&reservation.expenseRevision===r.expense_revision);return {receiptVersion:r.revision,operationId:r.operation_id,actorId:r.actor_id,recordedAt:r.recorded_at,reservation:r.reservation,candidate:r.candidate};});
 expenseReceiptSources({businessId:input.businessId,expenseHistory:expenses,receiptHistory:receipts});
 const requiredActorIds=[...new Set([...history.rows.map(r=>r.actorId),...receipts.map(r=>String(r.actorId))])].sort(),requiredOperationIds=[...new Set([...history.rows.map(r=>r.operationId),...receipts.map(r=>String(r.operationId))])].sort();
 const tables={} as Record<Group,Readonly<{csv:string;escapeMap:string;dictionary:string}>>;let total=0;
 for(const group of groups){
  const spec=expenseSourceTables[group],json:readonly string[]=spec.json,lines=[spec.columns.map(quote).join(',')],escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[];
  total+=Buffer.byteLength(lines[0]!)+2;check(total<=16*1024*1024);
  for(const row of rows[group]){
   const id=spec.key.map(k=>String(row[k])).join(':');
   const line=spec.columns.map(column=>{const original=row[column];if(original===null)return quote('\\N');check(json.includes(column)||typeof original==='string');let value=(json.includes(column)?JSON.stringify(original):String(original)).replaceAll('\\','\\\\');if(value.startsWith("'")||['=','+','-','@'].includes(value.trimStart()[0]??'')){value="'"+value;escapes.push({row_id:id,column,apostrophe_prefix:true});}return quote(value);}).join(',');
   total+=Buffer.byteLength(line)+2;check(total<=16*1024*1024);lines.push(line);
  }
  tables[group]=Object.freeze({csv:lines.join('\r\n')+'\r\n',escapeMap:JSON.stringify({schemaVersion:1,entity:spec.entity,businessId:input.businessId,snapshotToken:input.snapshotToken,keyColumns:spec.key,escapes})+'\n',dictionary:JSON.stringify({schemaVersion:1,entity:spec.entity,columns:spec.columns,keyColumns:spec.key,jsonColumns:spec.json,null:'\\N',format:'UTF-8 RFC4180 CRLF. Import UUIDs, revisions and instants as text. Unescaped \\N is null; remove only the mapped apostrophe, then unescape paired backslashes. Parse JSON columns after decoding.',identity:'Composite source identity; no fabricated id, created_by or created_at.',assurance:'Supplied-source consistency only; no complete business export or backup claim.'})+'\n'});
 }
 const references=JSON.stringify({schemaVersion:1,businessId:input.businessId,snapshotToken:input.snapshotToken,requiredActorIds,requiredOperationIds,externalReferenceClosureVerified:false})+'\n';
 const parts=[...groups.flatMap(group=>Object.entries(tables[group]).map(([kind,content])=>({name:expenseSourceTables[group].entity+(kind==='csv'?'.csv':kind==='escapeMap'?'_escape_map.json':'_dictionary.json'),content}))),{name:'expense_source_references.json',content:references}];
 const manifest=JSON.stringify({schemaVersion:1,scope:'owner_expense_sources',businessId:input.businessId,snapshotToken:input.snapshotToken,commercialSnapshotToken:input.commercialSnapshotToken,recordCounts:input.expectedCounts,parts:parts.map(({name,content})=>({name,bytes:Buffer.byteLength(content),sha256:hash(content)})),referenceClosureComplete:false,completePortableExport:false,completeBackup:false})+'\n';
 return Object.freeze({expenses:tables.expenses,receipts:tables.receipts,references,manifest});
}
