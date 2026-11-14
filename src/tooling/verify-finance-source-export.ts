import {createHash} from 'node:crypto';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {readSourceExportCsv} from '../security/source-export-csv-reader.ts';
import {financeSourceTables} from '../bookkeeping/finance-source-profile.ts';
import {verifyHeldTipSourceClosure} from '../bookkeeping/held-tip-source.ts';
import {verifyInvoiceCreditSourceClosure} from '../bookkeeping/invoice-credit-source.ts';
import {verifyPairedInvoiceCreditSourceClosure} from '../bookkeeping/paired-invoice-credit-source.ts';
import {verifyServiceRefundSourceClosure} from '../bookkeeping/service-refund-source.ts';
import {isExcessReturnOperation,verifyExcessReturnSourceClosure} from '../bookkeeping/excess-return-source.ts';
import {isTipReturnOperation,verifyTipReturnSourceClosure} from '../bookkeeping/tip-return-source.ts';
import {isCollectionFailureOperation,verifyCollectionFailureSourceClosure} from '../bookkeeping/collection-failure-source.ts';
import {isRefundTransferOperation,verifyRefundTransferSourceClosure} from '../bookkeeping/refund-transfer-source.ts';
import {isDirectReceiptTipOperation,verifyDirectReceiptTipSourceClosure} from '../bookkeeping/direct-receipt-tip-source.ts';

type Part=Readonly<{name:string;content:string}>;
type Row=Readonly<Record<string,unknown>>;
const limit=32*1024*1024;
const maxRows=10_000;
const sha=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
const token=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=maxRows;
const names=['operation_history.ndjson','audit_event_history.ndjson','dictionary.json','README.txt'];

function require(value:unknown):asserts value{
  if(!value)throw Error('FINANCE_SOURCE_VERIFICATION_REQUIRED');
}

function record(text:string){
  const value:unknown=JSON.parse(text);
  require(value!==null&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}

function money(value:unknown){
  require(typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n);
  return BigInt(value);
}

export function verifyFinanceSourceExport(manifestText:string,parts:readonly Part[],businessId:string){
  require(customerUuid(businessId)&&typeof manifestText==='string'&&Buffer.byteLength(manifestText)<=limit);
  const manifest=record(manifestText),version=manifest.schemaVersion;
  require(exact(manifest,['schemaVersion','scope','businessId','currency','observedAt','historySnapshotToken','sourceTokens',
    'rowCounts','historyCounts','completePortableExport','referenceClosureComplete','completeBackup','files'])
    &&(version===1||version===2||version===3||version===4||version===5||version===6||version===7||version===8||version===9||version===10||version===11||version===12||version===13)
    &&manifest.scope==='crest.posted-finance-source.v'+version&&manifest.businessId===businessId
    &&manifest.currency==='USD'&&typeof manifest.observedAt==='string'&&Number.isFinite(Date.parse(manifest.observedAt))
    &&token(manifest.historySnapshotToken)&&manifest.completePortableExport===false&&manifest.referenceClosureComplete===false
    &&manifest.completeBackup===false);
  const sourceNames=['invoice','receipt','expense',...(version>=2?['correction']:[]),...(version>=3?['application']:[]),
    ...(version>=4?['tip']:[]),...(version>=5?['credit']:[]),...(version>=6?['paired']:[]),...(version>=7?['refund']:[]),
    ...(version>=9?['excessReturn']:[]),...(version>=10?['tipReturn']:[]),...(version>=11?['collectionFailure']:[]),...(version>=12?['refundTransfer']:[]),...(version>=13?['directTip']:[])];
  require(exact(manifest.sourceTokens,sourceNames)&&Object.values(manifest.sourceTokens).every(token));
  const tables=financeSourceTables(version),expectedNames=new Set([...names,...tables.flatMap(({name})=>[name+'.csv',name+'_escape_map.json'])]);
  require(exact(manifest.rowCounts,tables.map(table=>table.name))&&Object.values(manifest.rowCounts).every(count)
    &&exact(manifest.historyCounts,['operations','auditEvents'])&&Object.values(manifest.historyCounts).every(count)
    &&Array.isArray(manifest.files)&&manifest.files.length===expectedNames.size&&parts.length===expectedNames.size);
  const files=new Map<string,string>();
  let total=Buffer.byteLength(manifestText);
  for(const part of parts){
    require(part&&expectedNames.has(part.name)&&!files.has(part.name)&&typeof part.content==='string'
      &&Buffer.from(part.content).toString('utf8')===part.content&&!part.content.includes('\0'));
    total+=Buffer.byteLength(part.content);
    require(total<=limit);
    files.set(part.name,part.content);
  }
  const listed=new Set<string>();
  for(const entry of manifest.files){
    require(exact(entry,['name','bytes','sha256'])&&typeof entry.name==='string'&&!listed.has(entry.name)&&token(entry.sha256));
    const content=files.get(entry.name);
    require(content!==undefined&&entry.bytes===Buffer.byteLength(content)&&entry.sha256===sha(content));
    listed.add(entry.name);
  }
  const {tables:dictionaryTables}=record(files.get('dictionary.json')!);
  require(Array.isArray(dictionaryTables)&&dictionaryTables.length===tables.length
    &&tables.every(({name,columns},index)=>{
      const row:unknown=dictionaryTables[index];
      if(!exact(row,['name','columns'])||row.name!==name)return false;
      const wireColumns=row.columns;
      return Array.isArray(wireColumns)&&wireColumns.length===columns.length&&columns.every((column,i)=>wireColumns[i]===column);
    }));

  const decoded=new Map<string,readonly Row[]>();
  let rows=0;
  for(const {name,columns} of tables){
    const map=record(files.get(name+'_escape_map.json')!);
    require(exact(map,['schemaVersion','entity','businessId','escapes'])&&map.schemaVersion===1
      &&map.entity===name&&map.businessId===businessId);
    const records=readSourceExportCsv(files.get(name+'.csv'),map.escapes,{
      columns,booleans:name==='accounting_periods'?['opening_boundary']:[],maxRows,
    });
    rows+=records.length;
    require(rows<=maxRows&&records.length===manifest.rowCounts[name]&&records.every(row=>row.business_id===businessId));
    decoded.set(name,records);
  }
  const history={operation:[] as Row[],audit_event:[] as Row[]};
  for(const [kind,key] of [['operation','operations'],['audit_event','auditEvents']] as const){
    const content=files.get(kind+'_history.ndjson')!;
    const lines=content===''?[]:content.split('\n');
    require((content===''||lines.pop()==='')&&lines.length===manifest.historyCounts[key]);
    let prior='';
    for(const line of lines){
      const entry=record(line);
      require(exact(entry,['record_id','representation','canonical_evidence','evidence_hash'])
        &&customerUuid(entry.record_id)&&entry.record_id>prior&&entry.representation==='snapshot_projection'
        &&typeof entry.canonical_evidence==='string'&&entry.evidence_hash===sha(entry.canonical_evidence));
      const evidence=record(entry.canonical_evidence);
      require(exact(evidence,['schemaVersion','kind','businessId','jsonTextColumns','row'])
        &&evidence.schemaVersion===1&&evidence.kind===kind&&evidence.businessId===businessId
        &&evidence.row&&typeof evidence.row==='object'&&'business_id' in evidence.row&&evidence.row.business_id===businessId
        &&'id' in evidence.row&&evidence.row.id===entry.record_id);
      prior=entry.record_id;
      require(version>=9||kind!=='operation'||!isExcessReturnOperation(evidence.row as Row));
      require(version>=10||kind!=='operation'||!isTipReturnOperation(evidence.row as Row));
      require(version>=11||kind!=='operation'||!isCollectionFailureOperation(evidence.row as Row));
      require(version>=12||kind!=='operation'||!isRefundTransferOperation(evidence.row as Row));
      require(version>=13||kind!=='operation'||!isDirectReceiptTipOperation(evidence.row as Row));
      if(version>=4)history[kind].push(evidence.row as Row);
    }
  }
  const events=new Map(decoded.get('financial_events')!.map(row=>[row.id,row]));
  const entries=new Map(decoded.get('journal_entries')!.map(row=>[row.id,row]));
  const balances=new Map<unknown,{debit:bigint;credit:bigint}>();
  for(const line of decoded.get('journal_lines')!){
    const entry=entries.get(line.entry_id);
    require(entry&&events.has(entry.event_id));
    const debit=money(line.debit_cents),credit=money(line.credit_cents);
    require((debit===0n)!==(credit===0n));
    const balance=balances.get(entry.id)??{debit:0n,credit:0n};
    balance.debit+=debit;balance.credit+=credit;balances.set(entry.id,balance);
  }
  require(entries.size===balances.size&&[...balances.values()].every(balance=>balance.debit===balance.credit));
  if(version>=4)verifyHeldTipSourceClosure(table=>version>=7&&table==='fund_lot_range_consumptions'
    ?decoded.get(table)!.filter(row=>row.service_refund_id===null&&(version<9||row.excess_return_id===null)
      &&(version<11||row.collection_failure_component_id===null)):decoded.get(table)!,history,version>=13);
  if(version===5)verifyInvoiceCreditSourceClosure(table=>decoded.get(table)!,history);
  if(version>=6)verifyPairedInvoiceCreditSourceClosure(table=>decoded.get(table)!,history);
  const originalRefundRows=(table:string)=>version>=12&&table==='financial_events'
    ?decoded.get(table)!.filter(row=>row.refund_transfer_adjustment_id===null):decoded.get(table)!;
  if(version>=7)verifyServiceRefundSourceClosure(originalRefundRows,history);
  if(version>=8){
    const roots=new Map(decoded.get('funding_origins')!.map(row=>[row.id,row]));
    const parts=new Map(decoded.get('funding_partitions')!.map(row=>[row.id,row]));
    const payments=new Map(decoded.get('payments')!.map(row=>[row.id,row]));
    const operations=new Map(history.operation.map(row=>[row.operation_id,row]));
    const heldLines=decoded.get('journal_lines')!.filter(row=>row.purpose==='receipt_funds');
    const byLot=new Map(heldLines.map(row=>[row.fund_lot_id,row]));
    const applied=new Set(decoded.get('allocation_events')!.map(row=>row.partition_id));
    const seen=new Set<unknown>();
    require(byLot.size===heldLines.length);
    for(const lot of decoded.get('customer_fund_lots')!){
      if(version>=13&&lot.receipt_tip_event_id!==null){
        require(customerUuid(lot.receipt_tip_event_id)&&lot.receipt_event_id===null&&lot.unapplication_id===null&&!byLot.has(lot.id));
        continue;
      }
      if(lot.receipt_event_id===null){require(customerUuid(lot.unapplication_id)&&!byLot.has(lot.id));continue;}
      require(lot.unapplication_id===null&&customerUuid(lot.receipt_event_id)&&!seen.has(lot.receipt_event_id));
      seen.add(lot.receipt_event_id);
      const event=events.get(lot.receipt_event_id),line=byLot.get(lot.id),root=roots.get(lot.origin_id),part=parts.get(lot.parent_partition_id);
      const entry=line&&entries.get(line.entry_id),payment=event&&payments.get(event.payment_id),operation=payment&&operations.get(payment.operation_id);
      const receipt=operation&&typeof operation.result==='string'?record(operation.result):null;
      require(event?.template==='P03'&&root&&part&&payment&&line&&entry?.event_id===event.id
        &&root.payment_id===payment.id&&root.customer_id===lot.customer_id&&payment.customer_id===lot.customer_id
        &&part.origin_id===root.id&&part.last_cent===root.cents&&!applied.has(part.id)
        &&money(part.last_cent)-money(part.first_cent)+1n===money(lot.original_cents)
        &&line.account_id===lot.account_id&&line.fixed_mapping_id===lot.mapping_id&&line.debit_cents==='0'&&line.credit_cents===lot.original_cents
        &&operation?.command_type==='finance.receipt.record'&&operation.state==='committed'
        &&(receipt?.schemaVersion===2||version>=13&&receipt?.schemaVersion===3)
        &&receipt?.paymentId===payment.id&&receipt.eventId===event.id&&receipt.fundingOriginId===root.id
        &&exact(receipt.heldFunds,['lotId','fundingPartitionId','mappingId','cents'])&&receipt.heldFunds.lotId===lot.id
        &&receipt.heldFunds.fundingPartitionId===part.id&&receipt.heldFunds.mappingId===lot.mapping_id&&receipt.heldFunds.cents===lot.original_cents);
    }
    require(seen.size===heldLines.length);
    const lots=new Map(decoded.get('customer_fund_lots')!.map(row=>[row.id,row]));
    const groups=new Map(decoded.get('atomic_finance_groups')!.map(row=>[row.id,row]));
    const applications=decoded.get('customer_fund_applications')!;
    const applicationEvents=new Map([...events.values()].filter(row=>row.template==='P04').map(row=>[row.fund_application_id,row]));
    const entryByEvent=new Map([...entries.values()].map(row=>[row.event_id,row]));
    const applicationLines=new Map<unknown,Row[]>();
    for(const row of decoded.get('journal_lines')!)if(row.fund_application_id!==null){
      const lines=applicationLines.get(row.fund_application_id)??[];
      lines.push(row);applicationLines.set(row.fund_application_id,lines);
    }
    const receivables=new Map(decoded.get('receivable_items')!.map(row=>[row.id,row]));
    for(const application of applications){
      const lot=lots.get(application.fund_lot_id);
      require(lot);
      if(lot.receipt_event_id===null)continue;
      const event=applicationEvents.get(application.id),original=events.get(lot.receipt_event_id);
      const group=event&&groups.get(event.group_id),sourceGroup=original&&groups.get(original.group_id);
      const item=receivables.get(application.receivable_id);
      const originalRequest=operations.get(application.operation_id);
      const receipt=originalRequest&&typeof originalRequest.result==='string'?record(originalRequest.result):null;
      const lines=applicationLines.get(application.id)??[];
      const funds=lines.find(row=>row.purpose==='apply_funds'),ar=lines.find(row=>row.purpose==='apply_ar');
      const cents=money(application.last_cent)-money(application.first_cent)+1n;
      require(event&&original&&group&&sourceGroup&&item&&typeof event.effective_on==='string'&&typeof original.effective_on==='string'
        &&event.effective_on>=original.effective_on&&money(group.commit_sequence)>money(sourceGroup.commit_sequence)
        &&group.operation_id===application.operation_id&&item.customer_id===lot.customer_id
        &&lines.length===2&&funds&&ar&&funds.entry_id===entryByEvent.get(event.id)?.id&&funds.entry_id===ar.entry_id
        &&funds.fund_lot_id===lot.id&&funds.fixed_mapping_id===lot.mapping_id&&funds.account_id===lot.account_id
        &&funds.debit_cents===String(cents)&&funds.credit_cents==='0'&&ar.credit_cents===String(cents)&&ar.debit_cents==='0'
        &&ar.receivable_id===item.id&&ar.account_id===item.account_id&&ar.fund_lot_id===null
        &&originalRequest?.command_type==='finance.funds.apply'&&originalRequest.state==='committed'
        &&receipt?.schemaVersion===2&&receipt.unapplicationId===null&&receipt.receiptEventId===original.id
        &&receipt.eventId===event.id&&receipt.fundApplicationId===application.id&&receipt.fundLotId===lot.id
        &&receipt.firstCent===application.first_cent&&receipt.lastCent===application.last_cent&&receipt.cents===String(cents));
    }
  }
  if(version>=9)verifyExcessReturnSourceClosure(originalRefundRows,history);
  if(version>=10)verifyTipReturnSourceClosure(table=>version>=11&&table==='tip_realization_range_consumptions'
    ?decoded.get(table)!.filter(row=>row.collection_failure_component_id===null):originalRefundRows(table),history);
  if(version>=11)verifyCollectionFailureSourceClosure(table=>decoded.get(table)!,history);
  if(version>=12)verifyRefundTransferSourceClosure(table=>decoded.get(table)!,history);
  if(version>=13)verifyDirectReceiptTipSourceClosure(table=>decoded.get(table)!,history);
  const totals=[...balances.values()].reduce((sum,balance)=>sum+balance.debit,0n).toString();
  return Object.freeze({verified:true,profile:manifest.scope,files:files.size,sourceRows:rows,
    balancedJournalEntries:balances.size,debitCents:totals,creditCents:totals,
    assurance:'internal_consistency_only',completePortableExport:false,completeBackup:false});
}
