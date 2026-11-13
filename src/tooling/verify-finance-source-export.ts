import {createHash} from 'node:crypto';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {readSourceExportCsv} from '../security/source-export-csv-reader.ts';
import {financeSourceTables} from '../bookkeeping/finance-source-profile.ts';
import {verifyHeldTipSourceClosure} from '../bookkeeping/held-tip-source.ts';

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
    &&(version===1||version===2||version===3||version===4)&&manifest.scope==='crest.posted-finance-source.v'+version&&manifest.businessId===businessId
    &&manifest.currency==='USD'&&typeof manifest.observedAt==='string'&&Number.isFinite(Date.parse(manifest.observedAt))
    &&token(manifest.historySnapshotToken)&&manifest.completePortableExport===false&&manifest.referenceClosureComplete===false
    &&manifest.completeBackup===false);
  const sourceNames=['invoice','receipt','expense',...(version>=2?['correction']:[]),...(version>=3?['application']:[]),...(version===4?['tip']:[])];
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
      if(version===4)history[kind].push(evidence.row as Row);
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
  if(version===4)verifyHeldTipSourceClosure(table=>decoded.get(table)!,history);
  const totals=[...balances.values()].reduce((sum,balance)=>sum+balance.debit,0n).toString();
  return Object.freeze({verified:true,profile:manifest.scope,files:files.size,sourceRows:rows,
    balancedJournalEntries:balances.size,debitCents:totals,creditCents:totals,
    assurance:'internal_consistency_only',completePortableExport:false,completeBackup:false});
}
