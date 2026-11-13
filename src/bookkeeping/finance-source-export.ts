import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {readSourceExportCsv} from '../security/source-export-csv-reader.ts';
import {captureInvoiceSource,formatInvoiceSource} from './invoice-source.ts';
import {captureReceiptSource,formatReceiptSource} from './receipt-source.ts';
import {capturePostedExpenseSource,formatPostedExpenseSource} from './posted-expense-source.ts';
import {captureUnapplicationSource,formatUnapplicationSource,verifyUnapplicationSourceClosure} from './unapplication-source.ts';
import {captureFundApplicationSource,formatFundApplicationSource} from './fund-application-source.ts';
import {captureHeldTipSource,verifyHeldTipSourceClosure} from './held-tip-source.ts';
import {captureInvoiceCreditSource,verifyInvoiceCreditSourceClosure} from './invoice-credit-source.ts';
import {capturePairedInvoiceCreditSource,verifyPairedInvoiceCreditSourceClosure} from './paired-invoice-credit-source.ts';
import {captureServiceRefundSource,verifyServiceRefundSourceClosure} from './service-refund-source.ts';
import {correctionSourceColumns,financeSourceTables,fundApplicationSourceColumns,heldTipSourceColumns,invoiceCreditSourceColumns,serviceRefundSourceColumns} from './finance-source-profile.ts';

type Query=(sql:string,parameters:unknown[])=>Promise<unknown[]>;
type Cell=string|boolean|null;
type Row=Readonly<Record<string,Cell>>;
type File=Readonly<{name:string;content:string}>;
const digest=(content:string)=>createHash('sha256').update(content,'utf8').digest('hex');
const maxBytes=32*1024*1024;
const maxRows=10_000;
const nullableByProfile={
  invoice:{financial_events:['payment_id','posted_expense_id'],journal_lines:['money_movement_id','allocation_event_id']},
  receipt:{financial_events:['posted_expense_id']},
  expense:{},
  correction:{},
  application:{},
  tip:{},
  credit:{},
  paired:{},
  refund:{},
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
export async function captureFinanceSourceExport(businessId:string,query:Query,
  {includeCorrections=false,includeFundApplications=false,includeTips=false,includeCredits=false,includePairedCredits=false,includeServiceRefunds=false}:Readonly<{
    includeCorrections?:boolean;includeFundApplications?:boolean;includeTips?:boolean;includeCredits?:boolean;includePairedCredits?:boolean;
    includeServiceRefunds?:boolean;
  }>={}){
  check(customerUuid(businessId)&&(!includeFundApplications||includeCorrections)&&(!includeTips||includeFundApplications)
    &&(!includeCredits||includeTips)&&(!includePairedCredits||includeCredits)&&(!includeServiceRefunds||includePairedCredits));
  const one=async(sql:string,parameters:unknown[])=>{
    const result=await query(sql,parameters);
    check(Array.isArray(result)&&result.length===1&&exact(result[0],['result']));
    return result[0].result;
  };
  const invoice=await captureInvoiceSource(businessId,one);
  const receipt=await captureReceiptSource(businessId,query);
  const expense=await capturePostedExpenseSource(businessId,query);
  const pairedCapture=includePairedCredits?await capturePairedInvoiceCreditSource(businessId,query):null;
  const paired=pairedCapture?.paired??null;
  const correction=pairedCapture?{...pairedCapture.unapplication,history:pairedCapture.history}
    :includeCorrections?await captureUnapplicationSource(businessId,query):null;
  const application=includeFundApplications&&correction?await captureFundApplicationSource(businessId,query,{invoice,unapplication:correction}):null;
  const tip=includeTips?await captureHeldTipSource(businessId,query):null;
  const credit=pairedCapture?.credit??(includeCredits?await captureInvoiceCreditSource(businessId,query):null);
  const refund=includeServiceRefunds?await captureServiceRefundSource(businessId,query):null;
  const history=await one('SELECT crest_commands.business_history_export_context($1::uuid) AS result',[businessId]);
  check(exact(history,['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts'])
    &&history.schemaVersion===1&&history.scope==='business_history'&&history.businessId===businessId
    &&history.snapshotToken===invoice.historySnapshotToken&&history.snapshotToken===receipt.historySnapshotToken
    &&history.snapshotToken===expense.historySnapshotToken&&typeof history.observedAt==='string'
    &&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(history.observedAt)
    &&isDeepStrictEqual(receipt.history,expense.history)
    &&(!correction||history.snapshotToken===correction.historySnapshotToken&&isDeepStrictEqual(receipt.history,correction.history))
    &&(!application||history.snapshotToken===application.historySnapshotToken)
    &&(!tip||history.snapshotToken===tip.historySnapshotToken)&&(!credit||history.snapshotToken===credit.historySnapshotToken)
    &&(!paired||history.snapshotToken===paired.historySnapshotToken)&&(!refund||history.snapshotToken===refund.historySnapshotToken));
  // Keep each established profile's amount, lineage and round-trip checks.
  formatInvoiceSource(invoice);
  formatReceiptSource(receipt);
  formatPostedExpenseSource(expense);
  if(correction){
    if(paired)verifyUnapplicationSourceClosure(correction.rows,correction.history,
      new Set(paired.rows.paired_invoice_credit_releases.map(row=>row.operation_id)));
    else formatUnapplicationSource(correction);
  }
  if(application)formatFundApplicationSource(application);

  const version=refund?7:paired?6:credit?5:tip?4:application?3:correction?2:1;
  const tables=financeSourceTables(version);
  const profiles={invoice,receipt,expense,correction,application,tip,credit,paired,refund};
  const combined=new Map<string,Map<string,Row>>();
  let count=0,bytes=0;
  for(const {name,columns} of tables){
    const rows=new Map<string,Row>();
    for(const kind of ['invoice','receipt','expense','correction','application','tip','credit','paired','refund'] as const){
      const source=profiles[kind]?.rows;
      if(!source||!Object.hasOwn(source,name))continue;
      const knownNulls:Readonly<Record<string,readonly string[]>>=nullableByProfile[kind];
      const missing=kind==='refund'?[]:[...(knownNulls[name]??[]),
        ...(correction&&kind!=='correction'&&kind!=='application'&&kind!=='tip'&&kind!=='credit'?correctionSourceColumns['crest.'+name]??[]:[]),
        ...(application&&kind!=='application'&&kind!=='tip'&&kind!=='credit'?fundApplicationSourceColumns['crest.'+name]??[]:[]),
        ...(tip&&kind!=='tip'&&kind!=='credit'?heldTipSourceColumns['crest.'+name]??[]:[]),
        ...(credit&&kind!=='credit'?invoiceCreditSourceColumns['crest.'+name]??[]:[]),
        ...(refund?serviceRefundSourceColumns['crest.'+name]??[]:[])];
      for(const row of rowsOf(source,name)){
        check(count<maxRows&&customerUuid(row.id)&&row.business_id===businessId
          &&exact(row,columns.filter(column=>!missing.includes(column))));
        const normalized=Object.freeze(Object.fromEntries(columns.map(column=>[
          column,missing.includes(column)?null:row[column]!,
        ])));
        if(rows.has(row.id)){
          // A paired P05/P07 legitimately shares exactly one group. Both
          // separately scoped SQL readers must return byte-identical columns.
          check(paired&&name==='atomic_finance_groups'&&kind==='credit'&&isDeepStrictEqual(rows.get(row.id),normalized)
            &&paired.rows.paired_invoice_credit_releases.some(link=>link.operation_id===row.operation_id));
          continue;
        }
        rows.set(row.id,normalized);
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
  if(correction){
    const byId=(table:string,id:Cell|undefined)=>combined.get(table)!.get(String(id));
    const lots=new Map([...combined.get('customer_fund_lots')!.values()].map(row=>[row.unapplication_id,row]));
    const appliedReceivables=new Map([...combined.get('journal_lines')!.values()].filter(row=>row.purpose==='unapply_ar')
      .map(row=>[row.unapplication_id,row]));
    for(const row of combined.get('allocation_unapplications')!.values()){
      const allocation=byId('allocation_events',row.allocation_id),lot=lots.get(row.id);
      const partition=byId('funding_partitions',allocation?.partition_id),root=byId('funding_origins',partition?.origin_id);
      const receivable=byId('receivable_items',allocation?.receivable_id),ar=appliedReceivables.get(row.id);
      check(allocation&&lot&&partition&&root&&receivable&&ar
        &&lot.origin_id===root.id&&lot.parent_partition_id===partition.id&&lot.customer_id===root.customer_id
        &&lot.customer_id===receivable.customer_id&&ar.receivable_id===receivable.id&&ar.account_id===receivable.account_id
        &&BigInt(String(row.first_cent))>=BigInt(String(partition.first_cent))
        &&BigInt(String(row.last_cent))<=BigInt(String(partition.last_cent)));
    }
  }
  if(tip){
    const historyRows=(kind:'operation'|'audit_event')=>receipt.history[kind].map(item=>JSON.parse(item.canonical_evidence).row);
    const parsedHistory={
      operation:historyRows('operation'),audit_event:historyRows('audit_event'),
    };
    const tableRows=(table:string)=>[...combined.get(table)!.values()];
    verifyHeldTipSourceClosure(table=>refund&&table==='fund_lot_range_consumptions'
      ?tableRows(table).filter(row=>row.service_refund_id===null):tableRows(table),parsedHistory);
    if(paired)verifyPairedInvoiceCreditSourceClosure(tableRows,parsedHistory);
    else if(credit)verifyInvoiceCreditSourceClosure(tableRows,parsedHistory);
    if(refund)verifyServiceRefundSourceClosure(tableRows,parsedHistory);
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
    refund?'Includes supported settled service refunds, issued invoices, credits and payment releases, direct receipts, payment corrections, customer funds applications, tips, same-day posted expenses and their source history.'
      :paired?'Includes supported issued invoices, paired invoice credits and payment releases, standalone invoice credits, direct receipts, payment corrections, customer funds applications, confirmed tips from held funds, same-day posted expenses, their normalized journal and original history projections.'
      :credit?'Includes supported issued invoices, invoice credits, direct receipts, payment corrections, customer funds applications, confirmed tips from held funds, same-day posted expenses, their normalized journal and original history projections.'
      :tip?'Includes supported issued invoices, direct receipts, payment corrections, customer funds applications, confirmed tips from held funds, same-day posted expenses, their normalized journal and original history projections.'
      :application?'Includes supported issued invoices, direct receipts, payment corrections, customer funds applications, same-day posted expenses, their normalized journal and original history projections.'
      :correction?'Includes supported issued invoices, direct receipts, payment corrections, same-day posted expenses, their normalized journal and original history projections.'
      :'Includes supported issued invoices, direct receipts, same-day posted expenses, their normalized journal and original history projections.',
    'This is a partial source export. Account and customer directories, receipt bytes, broader transaction types and full recovery are outside this bundle.',
    'Use manifest.json to check file sizes and SHA-256 digests. The dictionary and escape maps describe how to recover exact CSV cells.',
  ].join('\n')+'\n');
  const manifest=JSON.stringify({schemaVersion:version,scope:'crest.posted-finance-source.v'+version,businessId,currency:'USD',
    observedAt:history.observedAt,historySnapshotToken:history.snapshotToken,
    sourceTokens:{invoice:invoice.snapshotToken,receipt:receipt.snapshotToken,expense:expense.snapshotToken,
      ...correction?{correction:correction.snapshotToken}:{},...application?{application:application.snapshotToken}:{},...tip?{tip:tip.snapshotToken}:{},
      ...credit?{credit:credit.snapshotToken}:{},...paired?{paired:paired.snapshotToken}:{},...refund?{refund:refund.snapshotToken}:{}},
    rowCounts:Object.fromEntries(tables.map(({name})=>[name,combined.get(name)!.size])),
    historyCounts:{operations:receipt.history.operation.length,auditEvents:receipt.history.audit_event.length},
    completePortableExport:false,referenceClosureComplete:false,completeBackup:false,
    files:files.map(({name,content})=>({name,bytes:Buffer.byteLength(content,'utf8'),sha256:digest(content)}))})+'\n';
  check(bytes+Buffer.byteLength(manifest)<=maxBytes);
  const result=Object.freeze({manifest,files:Object.freeze(files)});
  return Object.freeze({forServer:()=>result,toJSON():never{throw Error('FINANCE_SOURCE_EXPORT_PRIVATE');}});
}
