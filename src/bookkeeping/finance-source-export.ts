import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {readSourceExportCsv} from '../security/source-export-csv-reader.ts';
import {captureInvoiceSource,formatInvoiceSource,invoiceSourceCoverage} from './invoice-source.ts';
import {captureReceiptSource,formatReceiptSource,receiptSourceAddedColumns,receiptSourceCoverage} from './receipt-source.ts';
import {capturePostedExpenseSource,formatPostedExpenseSource,postedExpenseSourceAddedColumns,postedExpenseSourceCoverage} from './posted-expense-source.ts';

type Query=(sql:string,parameters:unknown[])=>Promise<unknown[]>;
type Cell=string|boolean|null;
type Row=Readonly<Record<string,Cell>>;
type File=Readonly<{name:string;content:string}>;
const digest=(content:string)=>createHash('sha256').update(content,'utf8').digest('hex');
const maxBytes=32*1024*1024;
const maxRows=10_000;
const additions:Readonly<Record<string,readonly string[]>>=receiptSourceAddedColumns;
const expenseAdditions:Readonly<Record<string,readonly string[]>>=postedExpenseSourceAddedColumns;
const tables=[...invoiceSourceCoverage,...receiptSourceCoverage,postedExpenseSourceCoverage].map(table=>({
  name:table.table.slice('crest.'.length),
  columns:[...table.required,...(additions[table.table]??[]),...(expenseAdditions[table.table]??[])],
}));
const nullableByProfile={
  invoice:{financial_events:['payment_id','posted_expense_id'],journal_lines:['money_movement_id','allocation_event_id']},
  receipt:{financial_events:['posted_expense_id']},
  expense:{},
} as const;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';

function check(value:unknown):asserts value{
  if(!value)throw Error('FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED');
}

function rowsOf(value:unknown,table:string):readonly Row[]{
  check(value!==null&&typeof value==='object'&&Object.hasOwn(value,table));
  const rows=(value as Record<string,unknown>)[table];
  check(Array.isArray(rows));
  return rows as Row[];
}

// A single authorized, read-only repeatable-read export transaction must own
// query for the entire capture. Every underlying SQL reader checks that mode.
export async function captureFinanceSourceExport(businessId:string,query:Query){
  check(customerUuid(businessId));
  const one=async(sql:string,parameters:unknown[])=>{
    const result=await query(sql,parameters);
    check(Array.isArray(result)&&result.length===1&&exact(result[0],['result']));
    return result[0].result;
  };
  const invoice=await captureInvoiceSource(businessId,one);
  const receipt=await captureReceiptSource(businessId,query);
  const expense=await capturePostedExpenseSource(businessId,query);
  const history=await one('SELECT crest_commands.business_history_export_context($1::uuid) AS result',[businessId]);
  check(exact(history,['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts'])
    &&history.schemaVersion===1&&history.scope==='business_history'&&history.businessId===businessId
    &&history.snapshotToken===invoice.historySnapshotToken&&history.snapshotToken===receipt.historySnapshotToken
    &&history.snapshotToken===expense.historySnapshotToken&&typeof history.observedAt==='string'
    &&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(history.observedAt)
    &&isDeepStrictEqual(receipt.history,expense.history));
  // Keep each established profile's amount, lineage and round-trip checks.
  formatInvoiceSource(invoice);
  formatReceiptSource(receipt);
  formatPostedExpenseSource(expense);

  const profiles={invoice,receipt,expense};
  const combined=new Map<string,Map<string,Row>>();
  let count=0,bytes=0;
  for(const {name,columns} of tables){
    const rows=new Map<string,Row>();
    for(const kind of ['invoice','receipt','expense'] as const){
      const source=profiles[kind].rows;
      if(!Object.hasOwn(source,name))continue;
      const knownNulls:Readonly<Record<string,readonly string[]>>=nullableByProfile[kind];
      const missing=knownNulls[name]??[];
      for(const row of rowsOf(source,name)){
        check(count<maxRows&&customerUuid(row.id)&&row.business_id===businessId&&!rows.has(row.id)
          &&exact(row,columns.filter(column=>!missing.includes(column))));
        rows.set(row.id,Object.freeze(Object.fromEntries(columns.map(column=>[
          column,missing.includes(column)?null:row[column]!,
        ]))));
        count++;
      }
    }
    combined.set(name,rows);
  }
  for(const row of combined.get('allocation_events')!.values()){
    const receivable=combined.get('receivable_items')!.get(String(row.receivable_id));
    const part=combined.get('funding_partitions')!.get(String(row.partition_id));
    const root=part&&combined.get('funding_origins')!.get(String(part.origin_id));
    check(receivable&&root&&receivable.customer_id===root.customer_id);
  }

  const files:File[]=[];
  function add(name:string,content:string){
    bytes+=Buffer.byteLength(content,'utf8');
    check(bytes<=maxBytes);
    files.push(Object.freeze({name,content}));
  }
  for(const {name,columns} of tables){
    const rows=[...combined.get(name)!.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0);
    const escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[];
    const lines=rows.map(([id,row])=>columns.map(column=>{
      const original=row[column];
      if(original===null)return quote('\\N');
      let value=String(original).replaceAll('\\','\\\\');
      if(typeof original==='string'&&(value.startsWith("'")||/^[=+@-]/.test(value.trimStart()))){
        value="'"+value;
        escapes.push({row_id:id,column,apostrophe_prefix:true});
      }
      return quote(value);
    }).join(','));
    const csv=[columns.map(quote).join(','),...lines].join('\r\n')+'\r\n';
    const booleans=name==='accounting_periods'?['opening_boundary']:[];
    const decoded=readSourceExportCsv(csv,escapes,{columns,booleans,maxRows});
    check(decoded.length===rows.length&&decoded.every((row,index)=>isDeepStrictEqual(row,rows[index]![1])));
    add(name+'.csv',csv);
    add(name+'_escape_map.json',JSON.stringify({schemaVersion:1,entity:name,businessId,escapes})+'\n');
  }
  for(const kind of ['operation','audit_event'] as const){
    const records=receipt.history[kind];
    // Carry the single history projection and its original hashes.
    add(kind+'_history.ndjson',records.map(row=>JSON.stringify(row)+'\n').join(''));
  }
  add('dictionary.json',JSON.stringify({schemaVersion:1,format:'UTF-8 RFC4180 CRLF',primaryKey:'id',
    null:'\\N',booleans:['accounting_periods.opening_boundary'],
    decode:'Import as text. Remove only the mapped leading apostrophe, then unescape paired backslashes. Retain decimal cents and JSON text exactly.',
    tables})+'\n');
  add('README.txt',[
    'Crest OS posted finance source export',
    'Includes supported issued invoices, direct receipts, same-day posted expenses, their normalized journal and original history projections.',
    'This is a partial source export. Account and customer directories, receipt bytes, broader transaction types and full recovery are outside this bundle.',
    'Use manifest.json to check file sizes and SHA-256 digests. The dictionary and escape maps describe how to recover exact CSV cells.',
  ].join('\n')+'\n');
  const manifest=JSON.stringify({schemaVersion:1,scope:'crest.posted-finance-source.v1',businessId,currency:'USD',
    observedAt:history.observedAt,historySnapshotToken:history.snapshotToken,
    sourceTokens:{invoice:invoice.snapshotToken,receipt:receipt.snapshotToken,expense:expense.snapshotToken},
    rowCounts:Object.fromEntries(tables.map(({name})=>[name,combined.get(name)!.size])),
    historyCounts:{operations:receipt.history.operation.length,auditEvents:receipt.history.audit_event.length},
    completePortableExport:false,referenceClosureComplete:false,completeBackup:false,
    files:files.map(({name,content})=>({name,bytes:Buffer.byteLength(content,'utf8'),sha256:digest(content)}))})+'\n';
  check(bytes+Buffer.byteLength(manifest)<=maxBytes);
  const result=Object.freeze({manifest,files:Object.freeze(files)});
  return Object.freeze({forServer:()=>result,toJSON():never{throw Error('FINANCE_SOURCE_EXPORT_PRIVATE');}});
}
