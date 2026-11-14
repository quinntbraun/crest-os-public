import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const dimensions={
  'crest.financial_events':['collection_failure_settlement_id'],
  'crest.journal_lines':['collection_failure_settlement_id','collection_failure_settlement_component_id'],
  'crest.customer_fund_lots':['collection_failure_settlement_component_id'],
} as const;
const tables={
  collection_failure_settlements:['id','business_id','failure_id','customer_id','channel_version_id','money_account_id',
    'evidence_id','actual_on','cents','confirmation','reason','operation_id','created_by','created_at'],
  collection_failure_settlement_components:['id','business_id','settlement_id','failure_id','failure_component_id',
    'parent_partition_id','first_cent','last_cent','receivable_id'],
  collection_failure_recredit_claims:['id','business_id','failure_component_id','first_cent','last_cent','legacy_recredit_id','settlement_component_id'],
} as const;
export const collectionFailureGroupedRecreditSourceCoverage=Object.freeze(Object.entries(tables).map(([name,required])=>({
  table:'crest.'+name,scope:'business' as const,required,excluded:[],partialEvidenceGroup:null,
})));
export const collectionFailureGroupedRecreditSourceColumns=Object.freeze(dimensions);

const groups=['collection_failure_settlements','collection_failure_settlement_components','collection_failure_recredit_claims',
  'customer_fund_lots','financial_events','atomic_finance_groups','journal_entries','journal_lines','money_movements','external_money_evidence'] as const;
type Group=typeof groups[number];
type Row=Readonly<Record<string,unknown>>;
type SourceRow=Readonly<Record<string,string|null>>;
const save='finance.collection_failure.recredit',retire='finance.collection_failure.retire_recredit';

function check(value:unknown):asserts value{if(!value)throw Error('COLLECTION_GROUPED_RECREDIT_SOURCE_REVIEW_REQUIRED');}
const amount=(value:unknown)=>{
  check(typeof value==='string'&&/^-?(0|[1-9][0-9]{0,18})$/.test(value)&&isFinanceCents(value.startsWith('-')?value.slice(1):value));
  return BigInt(value);
};
const index=(rows:readonly Row[],key='id')=>{
  const found=new Map(rows.map(row=>[row[key],row]));check(found.size===rows.length);return found;
};
const bucket=(rows:readonly Row[],key:string)=>{
  const found=new Map<unknown,Row[]>();
  for(const row of rows){const entries=found.get(row[key])??[];entries.push(row);found.set(row[key],entries);}
  return found;
};

export function isCollectionFailureGroupedRecreditOperation(row:Row){
  return (row.command_type===save||row.command_type===retire)&&row.state==='committed';
}

export async function captureCollectionFailureGroupedRecreditSource(businessId:string,historySnapshotToken:string,
  query:(sql:string,args:unknown[])=>Promise<unknown[]>){
  const result=await query('SELECT crest_commands.collection_failure_grouped_recredit_source_snapshot($1::uuid) AS result',[businessId]);
  check(result.length===1&&exact(result[0],['result']));
  const source=result[0].result;
  check(exact(source,['schemaVersion','businessId','historySnapshotToken','rows'])&&source.schemaVersion===1
    &&source.businessId===businessId&&source.historySnapshotToken===historySnapshotToken&&/^[a-f0-9]{64}$/.test(historySnapshotToken)
    &&exact(source.rows,groups)&&Buffer.byteLength(JSON.stringify(source))<=4*1024*1024+512);
  const rows={} as Record<Group,readonly SourceRow[]>;
  let count=0;
  for(const name of groups){
    const page=source.rows[name];
    check(Array.isArray(page));
    count+=page.length;check(count<=1000);
    let after='';
    rows[name]=page.map((row:unknown)=>{
      check(row!==null&&typeof row==='object'&&!Array.isArray(row)&&'id' in row&&customerUuid(row.id)&&row.id>after
        &&'business_id' in row&&row.business_id===businessId&&Object.values(row).every(cell=>cell===null||typeof cell==='string'));
      after=row.id;
      return row as SourceRow;
    });
  }
  return {rows,snapshotToken:createHash('sha256').update('crest.collection-failure-grouped-recredit.v1:'+historySnapshotToken).digest('hex')};
}

export function verifyCollectionFailureGroupedRecreditSourceClosure(read:(table:string)=>readonly Row[],
  history:Readonly<{operation:readonly Row[];audit_event:readonly Row[]}>){
  const settlements=index(read('collection_failure_settlements')),children=index(read('collection_failure_settlement_components'));
  const legacy=index(read('collection_failure_recredits')),failures=index(read('collection_failures'));
  const failedComponents=index(read('collection_failure_components')),payments=index(read('payments'));
  const parts=index(read('funding_partitions')),roots=index(read('funding_origins'));
  const lots=index(read('customer_fund_lots')),recovered=index([...lots.values()].filter(row=>row.collection_failure_settlement_component_id!==null),
    'collection_failure_settlement_component_id');
  const events=index(read('financial_events')),settlementEvents=index([...events.values()].filter(row=>row.collection_failure_settlement_id!==null),
    'collection_failure_settlement_id');
  const failureEvents=index([...events.values()].filter(row=>row.collection_failure_id!==null),'collection_failure_id');
  const groupsById=index(read('atomic_finance_groups')),entries=index(read('journal_entries'),'event_id');
  const evidence=index(read('external_money_evidence')),moves=index(read('money_movements'),'event_id');
  const lines=read('journal_lines'),linesByEntry=bucket(lines,'entry_id');
  const allocations=index(read('allocation_events')),unapplications=index(read('allocation_unapplications'));
  const applications=index(read('customer_fund_applications')),tips=index(read('tip_realizations')),receivables=index(read('receivable_items'));
  const invoices=index(read('invoices')),issued=index([...events.values()].filter(row=>row.invoice_id!==null),'invoice_id');
  const credits=index(read('invoice_credits'));
  const applicationsByEvent=index([...events.values()].filter(row=>row.fund_application_id!==null),'fund_application_id');
  const releasesByEvent=index([...events.values()].filter(row=>row.unapplication_id!==null),'unapplication_id');
  const creditsByEvent=index([...events.values()].filter(row=>row.invoice_credit_id!==null),'invoice_credit_id');
  const operations=index(history.operation,'operation_id');
  const audits=index(history.audit_event.filter(row=>row.entity_kind==='collection_failure_settlements'&&row.action==='recredit'),'operation_id');
  const applicationAudits=index(history.audit_event.filter(row=>row.entity_kind==='customer_fund_applications'&&row.action==='apply'),'operation_id');
  const mappingReviews=history.operation.filter(row=>row.command_type==='finance.mapping.approve'&&row.state==='committed'
    &&typeof row.result==='string').map(row=>JSON.parse(row.result as string) as Row);
  const childSets=bucket([...children.values()],'settlement_id');
  check(settlements.size===settlementEvents.size&&settlements.size===childSets.size&&settlements.size===audits.size);
  const appliedRecovered=new Set<unknown>(),seenLots=new Set<unknown>(),seenLines=new Set<unknown>(),seenClaims=new Set<unknown>();
  const claimRows=read('collection_failure_recredit_claims');
  const claimSpans=bucket(claimRows,'failure_component_id');
  for(const records of claimSpans.values()){
    const ordered=[...records].sort((a,b)=>amount(a.first_cent)<amount(b.first_cent)?-1:1);
    let last=0n;
    for(const claim of ordered){
      const first=amount(claim.first_cent),end=amount(claim.last_cent),hasLegacy=claim.legacy_recredit_id!==null;
      const source=hasLegacy?legacy.get(claim.legacy_recredit_id):children.get(claim.settlement_component_id);
      check(source&&first>last&&end>=first&&customerUuid(claim.id)&&(!hasLegacy||claim.settlement_component_id===null)&&!seenClaims.has(source.id)
        &&claim.failure_component_id===source.failure_component_id&&claim.first_cent===source.first_cent&&claim.last_cent===source.last_cent);
      seenClaims.add(source.id);
      last=end;
    }
  }
  check(seenClaims.size===legacy.size+children.size&&claimRows.length===seenClaims.size);

  const order=(event:Row)=>amount(groupsById.get(event.group_id)?.commit_sequence);
  for(const recoveredPayment of settlements.values()){
    const related=childSets.get(recoveredPayment.id),event=settlementEvents.get(recoveredPayment.id),failure=failures.get(recoveredPayment.failure_id);
    const failed=failure&&failureEvents.get(failure.id),original=failure&&events.get(failure.original_event_id);
    const payment=failure&&payments.get(failure.payment_id),group=event&&groupsById.get(event.group_id);
    const move=event&&moves.get(event.id),proof=move&&evidence.get(move.evidence_id),entry=event&&entries.get(event.id);
    const operation=operations.get(recoveredPayment.operation_id),audit=audits.get(recoveredPayment.operation_id);
    check(related?.length&&event&&failure&&failed&&original&&payment&&group&&move&&proof&&entry&&operation&&audit
      &&failure.kind==='settled_failure'&&original.template==='P03'&&original.payment_id===payment.id
      &&payment.customer_id===recoveredPayment.customer_id&&event.template==='P11'&&event.template_version==='3'
      &&event.effective_on===recoveredPayment.actual_on&&customerDate(event.effective_on)&&customerDate(failure.effective_on)
      &&event.effective_on>=failure.effective_on&&order(event)>order(failed)
      &&group.operation_id===operation.operation_id&&group.recovery_epoch===operation.recovery_epoch&&operation.actor_id===recoveredPayment.created_by
      &&operation.command_type===save&&operation.state==='committed'&&String(operation.result_schema_version)==='2'
      &&audit.actor_id===operation.actor_id&&audit.entity_id===recoveredPayment.id&&audit.reason===recoveredPayment.reason
      &&move.account_id===recoveredPayment.money_account_id&&move.evidence_id===recoveredPayment.evidence_id
      &&proof.external_account_id===move.account_id&&proof.confirmed_on===recoveredPayment.actual_on&&proof.currency==='USD'
      &&proof.normalization_rule==='exact_case_v1'&&proof.signed_cents===move.signed_cents&&move.signed_cents===recoveredPayment.cents
      &&financeAccountReviewReason(recoveredPayment.confirmation)&&financeAccountReviewReason(recoveredPayment.reason));
    const posted=linesByEntry.get(entry.id)??[];
    const cash=posted.find(row=>row.purpose==='collection_settlement_money');
    check(cash&&cash.money_movement_id===move.id&&cash.account_id===move.account_id&&cash.debit_cents===recoveredPayment.cents&&cash.credit_cents==='0'
      &&cash.collection_failure_settlement_component_id===null&&posted.length===related.length+1
      &&posted.every(row=>row.collection_failure_settlement_id===recoveredPayment.id));
    posted.forEach(row=>seenLines.add(row.id));
    let total=0n;
    const components=[];
    const dispositions=new Map<unknown,{ar:bigint;held:bigint}>();
    for(const child of [...related].sort((a,b)=>amount(a.first_cent)<amount(b.first_cent)?-1:1)){
      const damaged=failedComponents.get(child.failure_component_id);
      check(damaged&&child.failure_id===failure.id&&damaged.collection_failure_id===failure.id&&damaged.payment_id===payment.id);
      const allocation=allocations.get(damaged.allocation_id),application=applications.get(damaged.fund_application_id),tip=tips.get(damaged.tip_realization_id);
      const oldLot=lots.get(damaged.fund_lot_id??application?.fund_lot_id??tip?.fund_lot_id);
      const partition=parts.get(allocation?.partition_id??oldLot?.parent_partition_id),root=partition&&roots.get(partition.origin_id);
      const item=receivables.get(allocation?.receivable_id??application?.receivable_id);
      const first=amount(child.first_cent),last=amount(child.last_cent),value=last-first+1n;
      const credit=posted.find(row=>row.collection_failure_settlement_component_id===child.id);
      check(partition&&root&&partition.id===child.parent_partition_id&&root.payment_id===payment.id&&root.customer_id===recoveredPayment.customer_id
        &&first>=amount(damaged.root_first_cent)&&last<=amount(damaged.root_last_cent)&&value>0n
        &&credit&&credit.money_movement_id===null&&credit.debit_cents==='0'&&credit.credit_cents===String(value));
      total+=value;
      if(item){
        const balances=dispositions.get(item.id)??{ar:0n,held:0n};
        if(child.receivable_id===null)balances.held+=value;else balances.ar+=value;
        dispositions.set(item.id,balances);
      }
      const lot=recovered.get(child.id);
      if(child.receivable_id===null){
        check(lot&&credit.purpose==='collection_settlement_funds'&&credit.fund_lot_id===lot.id&&credit.account_id===lot.account_id
          &&credit.fixed_mapping_id===lot.mapping_id&&lot.origin_id===root.id&&lot.customer_id===root.customer_id
          &&lot.parent_partition_id===partition.id&&lot.original_cents===String(value)
          &&mappingReviews.some(mapping=>mapping.purpose==='customer_funds'&&mapping.id===lot.mapping_id&&mapping.accountId===lot.account_id
            &&customerDate(mapping.effectiveFrom)&&mapping.effectiveFrom<=String(event.effective_on)));
        seenLots.add(lot.id);
        const uses=read('fund_lot_range_consumptions').filter(row=>row.fund_lot_id===lot.id);
        let prior=first-1n;
        for(const use of [...uses].sort((a,b)=>amount(a.first_cent)<amount(b.first_cent)?-1:1)){
          const app=applications.get(use.fund_application_id),applied=app&&applicationsByEvent.get(app.id);
          const receivable=app&&receivables.get(app.receivable_id),invoice=receivable&&invoices.get(receivable.invoice_id);
          const issuedEvent=invoice&&issued.get(invoice.id),appEntry=applied&&entries.get(applied.id),appOperation=app&&operations.get(app.operation_id);
          const appAudit=app&&applicationAudits.get(app.operation_id);
          const lo=amount(use.first_cent),hi=amount(use.last_cent);
          check(app&&applied&&receivable&&appEntry&&appOperation&&appAudit&&issuedEvent
            &&app.fund_lot_id===lot.id&&receivable.customer_id===lot.customer_id&&lo>=first&&lo>prior&&hi<=last&&hi>=lo
            &&app.first_cent===use.first_cent&&app.last_cent===use.last_cent&&order(applied)>order(event)
            &&String(applied.effective_on)>=String(event.effective_on)&&String(applied.effective_on)>=String(issuedEvent.effective_on));
          const appLines=linesByEntry.get(appEntry.id)??[],sum=String(hi-lo+1n);
          check(appLines.length===2&&appLines.every(row=>row.fund_application_id===app.id)
            &&appLines.some(row=>row.purpose==='apply_funds'&&row.fund_lot_id===lot.id&&row.account_id===lot.account_id
              &&row.fixed_mapping_id===lot.mapping_id&&row.debit_cents===sum&&row.credit_cents==='0')
            &&appLines.some(row=>row.purpose==='apply_ar'&&row.receivable_id===receivable.id&&row.account_id===receivable.account_id
              &&row.debit_cents==='0'&&row.credit_cents===sum)&&typeof appOperation.result==='string'&&typeof appAudit.delta==='string');
          const retained=JSON.parse(appOperation.result) as Row;
          check(retained.schemaVersion===4&&retained.collectionFailureSettlementEventId===event.id
            &&retained.collectionFailureSettlementComponentId===child.id&&retained.fundLotId===lot.id&&retained.receivableId===receivable.id
            &&retained.firstCent===use.first_cent&&retained.lastCent===use.last_cent&&retained.cents===sum
            &&isDeepStrictEqual(JSON.parse(appAudit.delta),{schemaVersion:1,before:null,after:retained}));
          prior=hi;appliedRecovered.add(app.id);
        }
      }else{
        check(!lot&&item&&item.id===child.receivable_id&&item.customer_id===recoveredPayment.customer_id
          &&credit.purpose==='collection_settlement_ar'&&credit.account_id===item.account_id&&credit.receivable_id===item.id);
      }
      components.push({settlementComponentId:child.id,failureComponentId:damaged.id,parentPartitionId:partition.id,
        firstCent:child.first_cent,lastCent:child.last_cent,cents:String(value),disposition:lot?'funds':'receivable',
        receivableId:child.receivable_id,fundLotId:lot?.id??null});
    }
    check(total===amount(recoveredPayment.cents)&&typeof operation.result==='string'&&typeof audit.delta==='string');
    const receipt=JSON.parse(operation.result) as Row;
    check(customerUuid(receipt.moneyChannelId)&&amount(receipt.moneyChannelVersion)>0n);
    const retained={schemaVersion:2,businessId:recoveredPayment.business_id,operationId:operation.operation_id,
      settlementId:recoveredPayment.id,eventId:event.id,failureId:failure.id,originalPaymentId:payment.id,originalEventId:original.id,
      customerId:recoveredPayment.customer_id,moneyAccountId:move.account_id,moneyChannelId:receipt.moneyChannelId,
      moneyChannelVersion:receipt.moneyChannelVersion,moneyMovementId:move.id,evidenceId:proof.id,actualOn:recoveredPayment.actual_on,
      cents:recoveredPayment.cents,confirmation:recoveredPayment.confirmation,reason:recoveredPayment.reason,components};
    check(isDeepStrictEqual(retained,receipt)&&isDeepStrictEqual(JSON.parse(audit.delta),{schemaVersion:1,before:null,after:receipt}));
    for(const [item,destination] of dispositions){
      const originalBalance=receivables.get(item);
      check(originalBalance);
      const deltas:{date:string;sequence:bigint;net:bigint}[]=[];
      for(const prior of events.values()){
        if(order(prior)>=order(event))continue;
        let net=0n;
        if(prior.template==='P03')for(const posted of allocations.values()){
          if(posted.event_id===prior.id&&posted.receivable_id===item)net-=amount(posted.cents);
        }
        if(prior.template==='P05'&&releasesByEvent.has(prior.unapplication_id)){
          const restored=unapplications.get(prior.unapplication_id);
          if(restored&&allocations.get(restored.allocation_id)?.receivable_id===item)net+=amount(restored.last_cent)-amount(restored.first_cent)+1n;
        }
        if(prior.template==='P04'){
          const app=applications.get(prior.fund_application_id);
          if(app?.receivable_id===item&&app)net-=amount(app.last_cent)-amount(app.first_cent)+1n;
        }
        if(prior.template==='P07'&&creditsByEvent.has(prior.invoice_credit_id)){
          const credit=credits.get(prior.invoice_credit_id);
          if(credit?.receivable_id===item&&credit)net-=amount(credit.inclusive_cents);
        }
        if(prior.template==='P11'){
          for(const line of linesByEntry.get(entries.get(prior.id)?.id)??[]){
            if(line.receivable_id===item)net+=amount(line.debit_cents)-amount(line.credit_cents);
          }
        }
        if(net!==0n)deltas.push({date:String(prior.effective_on),sequence:order(prior),net});
      }
      const on=String(event.effective_on);
      let running=amount(originalBalance.original_cents)+deltas.filter(delta=>delta.date<=on).reduce((total,delta)=>total+delta.net,0n);
      let capacity=running;
      for(const delta of deltas.filter(delta=>delta.date>on).sort((a,b)=>a.date.localeCompare(b.date)||(a.sequence<b.sequence?-1:1))){
        running+=delta.net;if(running<capacity)capacity=running;
      }
      check(destination.ar<=capacity&&(destination.held===0n||destination.ar===capacity));
    }
  }
  check(seenLots.size===recovered.size&&lines.every(line=>line.collection_failure_settlement_id===null||seenLines.has(line.id)));
  const recoveredIds=new Set([...recovered.values()].map(row=>row.id));
  check([...applications.values()].every(row=>!recoveredIds.has(row.fund_lot_id)||appliedRecovered.has(row.id)));
  const retired=index(history.operation.filter(row=>row.command_type===retire&&row.state==='committed'),'operation_id');
  const retained=index(history.audit_event.filter(row=>row.entity_kind==='operations'&&row.action==='retire'&&retired.has(row.operation_id)),'operation_id');
  check(retired.size===retained.size);
  for(const [id,row] of retired){
    const audit=retained.get(id);
    check(audit&&audit.entity_id===row.id&&audit.actor_id===row.actor_id&&typeof row.result==='string'&&typeof audit.delta==='string');
    const receipt:unknown=JSON.parse(row.result);
    check(exact(receipt,['schemaVersion','businessId','operationId','settlementId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===row.business_id&&receipt.operationId===id&&customerUuid(receipt.settlementId)
      &&customerUuid(receipt.originalEpoch)&&receipt.reviewEpoch===row.recovery_epoch&&receipt.reason===audit.reason
      &&isDeepStrictEqual(JSON.parse(audit.delta),{schemaVersion:1,before:null,after:receipt}));
  }
}
