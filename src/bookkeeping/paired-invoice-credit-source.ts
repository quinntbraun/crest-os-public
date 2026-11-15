import { isDeepStrictEqual } from 'node:util';
import { readSourceExportCsv } from '../security/source-export-csv-reader.ts';
import { createHash } from 'node:crypto';
import { verifyInvoiceCreditSourceClosure } from './invoice-credit-source.ts';
import { isFinanceCents } from './finance-inclusive-charge.ts';
import { customerDate, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';

const linkFields=['id','business_id','invoice_credit_id','unapplication_id','operation_id','actor_id','reviewed_ar_cents'] as const;
const shared=['atomic_finance_groups','financial_events','journal_entries','journal_lines'] as const;
const unapplicationGroups=['allocation_unapplications','customer_fund_lots',...shared] as const;
const creditGroups=['invoice_credits',...shared] as const;
const linkGroups=['paired_invoice_credit_releases'] as const;
type Row=Readonly<Record<string,string|null>>;
type Query=(sql:string,args:unknown[])=>Promise<unknown[]>;
type HistoryRow=Readonly<{record_id:string;representation:'snapshot_projection';canonical_evidence:string;evidence_hash:string}>;
type History={operation:HistoryRow[];audit_event:HistoryRow[]};
export const pairedInvoiceCreditSourceCoverage=Object.freeze({
  table:'crest.paired_invoice_credit_releases',scope:'business' as const,required:Object.freeze([...linkFields]),
  excluded:Object.freeze([]),partialEvidenceGroup:null,
});
const limit = 10_000;
const maxBytes = 16 * 1024 * 1024;
const token = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const count = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,4})$/.test(value) && Number(value) <= limit;


function requireSource(condition:unknown):asserts condition{
  if(!condition)throw Error('PAIRED_INVOICE_CREDIT_SOURCE_REVIEW_REQUIRED');
}

const digest=(input:string)=>createHash('sha256').update(input,'utf8').digest('hex');
function readHistory(value:HistoryRow,kind:keyof History,businessId:string){
  requireSource(customerUuid(value.record_id)&&value.representation==='snapshot_projection'
    &&value.evidence_hash===digest(value.canonical_evidence));
  const entry:unknown=JSON.parse(value.canonical_evidence);
  requireSource(exact(entry,['schemaVersion','kind','businessId','jsonTextColumns','row'])&&entry.schemaVersion===1
    &&entry.kind===kind&&entry.businessId===businessId&&entry.row!==null&&typeof entry.row==='object'
    &&'id' in entry.row&&entry.row.id===value.record_id&&'business_id' in entry.row&&entry.row.business_id===businessId);
  return entry.row as Readonly<Record<string,unknown>>;
}

function row(value:unknown,businessId:string,group:string):Row{
  requireSource(value!==null&&typeof value==='object'&&!Array.isArray(value)&&'id' in value&&customerUuid(value.id)
    &&'business_id' in value&&value.business_id===businessId&&Object.values(value).every(cell=>cell===null||typeof cell==='string'));
  if(group==='paired_invoice_credit_releases'){
    const candidate:unknown=value;
    requireSource(exact(candidate,linkFields)&&customerUuid(candidate.invoice_credit_id)&&customerUuid(candidate.unapplication_id)
      &&customerUuid(candidate.operation_id)&&customerUuid(candidate.actor_id)&&isFinanceCents(candidate.reviewed_ar_cents));
  }
  return value as Row;
}

export async function capturePairedInvoiceCreditSource(businessId:string,query:Query){
  requireSource(customerUuid(businessId));
  let bytes=0;
  async function run(sql:string,args:unknown[]){
    const results=await query(sql,args);
    requireSource(Array.isArray(results));
    bytes+=Buffer.byteLength(JSON.stringify(results));
    requireSource(bytes<=maxBytes);
    return results;
  }
  async function one(sql:string,args:unknown[]){
    const results=await run(sql,args);
    requireSource(results.length===1&&exact(results[0],['result']));
    return results[0].result;
  }
  async function profile<const Group extends string>(prefix:'paired_invoice_credit'|'unapplication'|'invoice_credit',
    scope:string,groups:readonly Group[],version:1|2){
    const versionSuffix=version===2?'_v2':'';
    const context=await one('SELECT crest_commands.'+prefix+'_source_snapshot_context'+versionSuffix+'($1::uuid) AS result',[businessId]);
    requireSource(exact(context,['schemaVersion','scope','businessId','snapshotToken','historySnapshotToken','counts'])
      &&context.schemaVersion===version&&context.scope===scope&&context.businessId===businessId
      &&token(context.snapshotToken)&&token(context.historySnapshotToken)&&exact(context.counts,groups));
    const {snapshotToken,historySnapshotToken}=context;
    const rows={} as Record<Group,Row[]>,counts={} as Record<Group,string>;
    let total=0;
    for(const group of groups){
      const expected=context.counts[group];
      requireSource(count(expected));
      counts[group]=expected;
      total+=Number(expected);
      requireSource(total<=limit);
      let after:string|null=null;
      const records:Row[]=[];
      for(;;){
        const result=await one('SELECT crest_commands.'+prefix+'_source_snapshot_page'+versionSuffix+'($1::uuid,$2::text,$3::text,$4::uuid,$5::integer) AS result',
          [businessId,snapshotToken,group,after,20]);
        requireSource(exact(result,['schemaVersion','businessId','snapshotToken','group','rows','hasMore'])&&result.schemaVersion===version
          &&result.businessId===businessId&&result.snapshotToken===snapshotToken&&result.group===group&&Array.isArray(result.rows)
          &&result.rows.length<=20&&typeof result.hasMore==='boolean'&&(!result.hasMore||result.rows.length>0));
        for(const value of result.rows){
          const next=row(value,businessId,group);
          requireSource(typeof next.id==='string'&&(after===null||next.id>after));
          records.push(next);
          after=next.id;
        }
        requireSource(records.length<=Number(expected));
        if(!result.hasMore)break;
      }
      requireSource(records.length===Number(expected));
      rows[group]=records;
    }
    return {businessId,snapshotToken,historySnapshotToken,counts,rows};
  }
  const paired=await profile('paired_invoice_credit','paired_invoice_credit_sources',linkGroups,1);
  const unapplication=await profile('unapplication','allocation_unapplication_sources_v2',unapplicationGroups,2);
  const credit=await profile('invoice_credit','invoice_credit_sources_v2',creditGroups,2);
  requireSource(paired.historySnapshotToken===unapplication.historySnapshotToken&&paired.historySnapshotToken===credit.historySnapshotToken);
  const historyContext=await one('SELECT crest_commands.business_history_export_context($1::uuid) AS result',[businessId]);
  requireSource(exact(historyContext,['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts'])
    &&historyContext.schemaVersion===1&&historyContext.scope==='business_history'&&historyContext.businessId===businessId
    &&historyContext.snapshotToken===paired.historySnapshotToken&&exact(historyContext.recordCounts,['operation','audit_event']));
  const history:History={operation:[],audit_event:[]};
  for(const kind of ['operation','audit_event'] as const){
    const expected=historyContext.recordCounts[kind];
    requireSource(count(expected));
    let after:string|null=null;
    for(;;){
      const page=await run('SELECT * FROM crest_commands.business_history_export_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer)',
        [businessId,paired.historySnapshotToken,kind,after,20]);
      if(!page.length)break;
      requireSource(page.length<=20);
      for(const value of page){
        requireSource(exact(value,['record_id','representation','canonical_evidence','evidence_hash'])&&customerUuid(value.record_id)
          &&(after===null||value.record_id>after)&&value.representation==='snapshot_projection'
          &&typeof value.canonical_evidence==='string'&&token(value.evidence_hash));
        const evidence=value as HistoryRow;
        readHistory(evidence,kind,businessId);
        history[kind].push(evidence);
        after=evidence.record_id;
      }
      requireSource(history[kind].length<=Number(expected));
    }
    requireSource(history[kind].length===Number(expected));
  }
  return {businessId,paired,unapplication,credit,history};
}

type PortableRow=Readonly<Record<string,unknown>>;
function groupRows(rows:readonly PortableRow[],field:string){
  const groups=new Map<unknown,PortableRow[]>();
  for(const row of rows){
    const values=groups.get(row[field])??[];
    values.push(row);
    groups.set(row[field],values);
  }
  return groups;
}
function locate(groups:ReadonlyMap<unknown,readonly PortableRow[]>,key:unknown){
  const matches=groups.get(key)??[];
  requireSource(matches.length===1);
  return matches[0]!;
}
function json(value:unknown){
  requireSource(typeof value==='string');
  return JSON.parse(value) as unknown;
}
function amount(value:unknown){
  requireSource(isFinanceCents(value));
  return BigInt(value);
}

export function verifyPairedInvoiceCreditSourceClosure(read:(table:string)=>readonly PortableRow[],
  history:{operation:readonly PortableRow[];audit_event:readonly PortableRow[]}){
  const links=read('paired_invoice_credit_releases'),credits=read('invoice_credits'),releases=read('allocation_unapplications');
  const lots=read('customer_fund_lots'), events=read('financial_events'), groups=read('atomic_finance_groups');
  const receivables=read('receivable_items'), allocations=read('allocation_events'), applications=read('customer_fund_applications');
  const creditsById=groupRows(credits,'id'),releasesById=groupRows(releases,'id'),allocationsById=groupRows(allocations,'id');
  const lotsByRelease=groupRows(lots,'unapplication_id'),receivablesById=groupRows(receivables,'id'),eventsById=groupRows(events,'id');
  const p05ByRelease=groupRows(events,'unapplication_id'),p07ByCredit=groupRows(events,'invoice_credit_id');
  const p04ByApplication=groupRows(events,'fund_application_id'),groupsById=groupRows(groups,'id');
  const operationsById=groupRows(history.operation,'operation_id'),auditsByOperation=groupRows(history.audit_event,'operation_id');
  const partitionsById=groupRows(read('funding_partitions'),'id'),rootsById=groupRows(read('funding_origins'),'id');
  const allocationsByReceivable=groupRows(allocations,'receivable_id'),releasesByAllocation=groupRows(releases,'allocation_id');
  const applicationsByReceivable=groupRows(applications,'receivable_id'),creditsByReceivable=groupRows(credits,'receivable_id');
  const journalByEvent=groupRows(read('journal_entries'),'event_id'),linesByEntry=groupRows(read('journal_lines'),'entry_id');
  const pairs=new Map<unknown,Readonly<{credit:PortableRow;release:PortableRow}>>();
  const creditSequences=new Set<unknown>(), releaseSequences=new Set<unknown>();
  for(const link of links){
    const credit=locate(creditsById,link.invoice_credit_id),release=locate(releasesById,link.unapplication_id);
    requireSource(!pairs.has(link.operation_id)&&!creditSequences.has(credit.id)&&!releaseSequences.has(release.id));
    creditSequences.add(credit.id);
    releaseSequences.add(release.id);
    const allocation=locate(allocationsById,release.allocation_id),lot=locate(lotsByRelease,release.id);
    const receivable=locate(receivablesById,credit.receivable_id);
    const p05=locate(p05ByRelease,release.id),p07=locate(p07ByCredit,credit.id);
    const group=locate(groupsById,p05.group_id),operation=locate(operationsById,link.operation_id);
    requireSource(p05.template==='P05'&&p05.event_sequence==='1'&&p07.template==='P07'&&p07.event_sequence==='2'
      &&p05.group_id===p07.group_id&&p05.period_id===p07.period_id&&p05.period_generation===p07.period_generation
      &&p05.effective_on===p07.effective_on&&p05.time_zone===p07.time_zone&&credit.receivable_id===allocation.receivable_id
      &&customerDate(p05.effective_on)&&credit.reason===release.reason&&credit.created_by===link.actor_id&&release.created_by===link.actor_id
      &&credit.operation_id===link.operation_id&&release.operation_id===link.operation_id&&group.operation_id===link.operation_id
      &&group.created_by===link.actor_id&&operation.command_type==='finance.invoice.credit_paired'&&operation.state==='committed'
      &&operation.actor_id===link.actor_id&&operation.recovery_epoch===group.recovery_epoch);
    const releaseCents=amount(release.last_cent)-amount(release.first_cent)+1n;
    const creditCents=amount(credit.inclusive_cents);
    const parent=locate(partitionsById,allocation.partition_id);
    const root=locate(rootsById,parent.origin_id);
    requireSource(releaseCents>0n&&releaseCents===amount(lot.original_cents)&&creditCents===amount(link.reviewed_ar_cents)+releaseCents
      &&lot.parent_partition_id===parent.id&&lot.origin_id===root.id&&lot.customer_id===root.customer_id&&lot.customer_id===receivable.customer_id
      &&amount(release.first_cent)>=amount(parent.first_cent)&&amount(release.last_cent)<=amount(parent.last_cent));
    const isBefore=(candidate:PortableRow)=>{
      const candidateGroup=locate(groupsById,candidate.group_id);
      requireSource(customerDate(candidate.effective_on)&&customerDate(p05.effective_on));
      return candidate.effective_on<=p05.effective_on&&amount(candidateGroup.commit_sequence)<amount(group.commit_sequence);
    };
    const originalPayment=locate(eventsById,allocation.event_id);
    requireSource(originalPayment.template==='P03'&&isBefore(originalPayment));
    let priorAr=amount(receivable.original_cents);
    for(const prior of allocationsByReceivable.get(receivable.id)??[]){
      if(isBefore(locate(eventsById,prior.event_id)))priorAr-=amount(prior.cents);
      for(const priorRelease of releasesByAllocation.get(prior.id)??[]){
        if(isBefore(locate(p05ByRelease,priorRelease.id)))priorAr+=amount(priorRelease.last_cent)-amount(priorRelease.first_cent)+1n;
      }
    }
    for(const application of applicationsByReceivable.get(receivable.id)??[]){
      if(isBefore(locate(p04ByApplication,application.id)))priorAr-=amount(application.last_cent)-amount(application.first_cent)+1n;
    }
    for(const prior of creditsByReceivable.get(receivable.id)??[]){
      if(isBefore(locate(p07ByCredit,prior.id)))priorAr-=amount(prior.inclusive_cents);
    }
    requireSource(priorAr===amount(link.reviewed_ar_cents));
    const releasedLines=linesByEntry.get(locate(journalByEvent,p05.id).id)??[];
    const ar=releasedLines.find(line=>line.purpose==='unapply_ar'),funds=releasedLines.find(line=>line.purpose==='unapply_funds');
    requireSource(releasedLines.length===2&&ar&&funds&&ar.receivable_id===receivable.id&&ar.account_id===receivable.account_id
      &&ar.debit_cents===String(releaseCents)&&ar.credit_cents==='0'&&funds.fund_lot_id===lot.id&&funds.account_id===lot.account_id
      &&funds.fixed_mapping_id===lot.mapping_id&&funds.debit_cents==='0'&&funds.credit_cents===String(releaseCents)
      &&releasedLines.every(line=>line.unapplication_id===release.id));
    const candidate=json(operation.result);
    requireSource(exact(candidate,['schemaVersion','credit','release'])&&candidate.schemaVersion===1
      &&candidate.credit!==null&&typeof candidate.credit==='object'&&candidate.release!==null&&typeof candidate.release==='object');
    const expectedRelease={schemaVersion:1,businessId:link.business_id,operationId:link.operation_id,unapplicationId:release.id,
      allocationId:allocation.id,eventId:p05.id,fundLotId:lot.id,fundingOriginId:root.id,parentPartitionId:parent.id,customerId:lot.customer_id,
      receivableId:receivable.id,arAccountId:receivable.account_id,fundsAccountId:lot.account_id,mappingId:lot.mapping_id,
      effectiveOn:p05.effective_on,firstCent:release.first_cent,lastCent:release.last_cent,cents:String(releaseCents),reason:release.reason};
    requireSource(isDeepStrictEqual(candidate.release,expectedRelease));
    const releaseAudit=locate(groupRows((auditsByOperation.get(link.operation_id)??[])
      .filter(a=>a.entity_kind==='allocation_unapplications'&&a.action==='unapply'),'entity_id'),release.id);
    requireSource(releaseAudit.actor_id===link.actor_id&&releaseAudit.entity_version==='1'&&releaseAudit.reason===release.reason
      &&isDeepStrictEqual(json(releaseAudit.delta),{schemaVersion:1,before:null,after:expectedRelease}));
    pairs.set(link.operation_id,{credit:candidate.credit as PortableRow,release:expectedRelease});
  }
  requireSource(events.every(event=>event.template!=='P07'||event.event_sequence!=='2'||creditSequences.has(event.invoice_credit_id))
    &&history.operation.filter(row=>row.command_type==='finance.invoice.credit_paired'&&row.state==='committed').length===pairs.size);
  // The existing P07 checker owns the precise original-cent calculation,
  // account pins, dated chronology, journals, and original credit audit.
  verifyInvoiceCreditSourceClosure(table=>table==='financial_events'?events.map(event=>
    event.template==='P07'&&creditSequences.has(event.invoice_credit_id)?{...event,event_sequence:'1'}:event):read(table),{
    ...history,operation:history.operation.map(operation=>{
      const paired=pairs.get(operation.operation_id);
      return paired?{...operation,command_type:'finance.invoice.credit',result:JSON.stringify(paired.credit)}:operation;
    }),
  });
}

export function formatPairedInvoiceCreditLinkCsv(source:Awaited<ReturnType<typeof capturePairedInvoiceCreditSource>>){
  const rows=source.paired.rows.paired_invoice_credit_releases.map(value=>row(value,source.businessId,'paired_invoice_credit_releases'));
  const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
  const csv=[linkFields.map(quote).join(','),...rows.map(item=>linkFields.map(field=>quote(item[field]!)).join(','))].join('\r\n')+'\r\n';
  requireSource(isDeepStrictEqual(readSourceExportCsv(csv,[],{columns:linkFields,maxRows:limit}),rows));
  return {csv,columns:linkFields};
}
