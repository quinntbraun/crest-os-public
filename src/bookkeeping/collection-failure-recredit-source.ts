import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const fields=['id','business_id','failure_id','failure_component_id','customer_id','channel_version_id','money_account_id',
  'evidence_id','actual_on','first_cent','last_cent','confirmation','reason','operation_id','created_by','created_at'] as const;
const groups=['collection_failure_recredits','customer_fund_lots','financial_events','atomic_finance_groups',
  'journal_entries','journal_lines','money_movements','external_money_evidence'] as const;
type Group=typeof groups[number];
type Row=Readonly<Record<string,unknown>>;
type SourceRow=Readonly<Record<string,string|null>>;
const save='finance.collection_failure.recredit_held',retire='finance.collection_failure.retire_held_recredit';

export const collectionFailureRecreditSourceCoverage=Object.freeze({
  table:'crest.collection_failure_recredits',scope:'business' as const,required:fields,excluded:[],partialEvidenceGroup:null,
});
export const collectionFailureRecreditSourceColumns=Object.freeze({
  'crest.financial_events':['collection_failure_recredit_id'],
  'crest.journal_lines':['collection_failure_recredit_id'],
  'crest.customer_fund_lots':['collection_failure_recredit_event_id'],
});

function check(value:unknown):asserts value{
  if(!value)throw Error('COLLECTION_RECREDIT_SOURCE_REVIEW_REQUIRED');
}

const cents=(value:unknown)=>{
  check(isFinanceCents(value));
  return BigInt(value);
};
const index=(rows:readonly Row[],key='id')=>{
  const mapped=new Map(rows.map(row=>[row[key],row]));
  check(mapped.size===rows.length);
  return mapped;
};

export function isCollectionFailureRecreditOperation(row:Row){
  return (row.command_type===save||row.command_type===retire)&&row.state==='committed';
}

export async function captureCollectionFailureRecreditSource(businessId:string,historySnapshotToken:string,
  query:(sql:string,args:unknown[])=>Promise<unknown[]>){
  const result=await query('SELECT crest_commands.collection_failure_recredit_source_snapshot($1::uuid) AS result',[businessId]);
  check(result.length===1&&exact(result[0],['result']));
  const source=result[0].result;
  check(exact(source,['schemaVersion','businessId','historySnapshotToken','rows'])&&source.schemaVersion===1
    &&source.businessId===businessId&&source.historySnapshotToken===historySnapshotToken&&/^[a-f0-9]{64}$/.test(historySnapshotToken)
    &&exact(source.rows,groups)&&Buffer.byteLength(JSON.stringify(source))<=4*1024*1024+512);
  const rows={} as Record<Group,readonly SourceRow[]>;
  let count=0;
  for(const group of groups){
    const page=source.rows[group];
    check(Array.isArray(page));
    count+=page.length;
    check(count<=1000);
    let after='';
    rows[group]=page.map((row:unknown)=>{
      check(row!==null&&typeof row==='object'&&!Array.isArray(row)&&'id' in row&&customerUuid(row.id)&&row.id>after
        &&'business_id' in row&&row.business_id===businessId&&Object.values(row).every(cell=>cell===null||typeof cell==='string'));
      after=row.id;
      return row as SourceRow;
    });
  }
  return {rows,snapshotToken:createHash('sha256').update('crest.collection-failure-recredit.v1:'+historySnapshotToken).digest('hex')};
}

export function verifyCollectionFailureRecreditSourceClosure(read:(table:string)=>readonly Row[],
  history:Readonly<{operation:readonly Row[];audit_event:readonly Row[]}>){
  const recoveries=index(read('collection_failure_recredits'));
  const failures=index(read('collection_failures')),parts=index(read('collection_failure_components'));
  const events=index(read('financial_events')),lots=index(read('customer_fund_lots'));
  const roots=index(read('funding_origins')),parentParts=index(read('funding_partitions')),payments=index(read('payments'));
  const recoveryEvents=index([...events.values()].filter(row=>row.collection_failure_recredit_id!==null),'collection_failure_recredit_id');
  const originalEvents=index([...events.values()].filter(row=>row.collection_failure_id!==null),'collection_failure_id');
  const recoveryLots=index([...lots.values()].filter(row=>row.collection_failure_recredit_event_id!==null),'collection_failure_recredit_event_id');
  const evidence=index(read('external_money_evidence')),movements=index(read('money_movements'),'event_id');
  const groupsById=index(read('atomic_finance_groups')),entries=index(read('journal_entries'),'event_id'),lines=read('journal_lines');
  const applications=index(read('customer_fund_applications'));
  const applicationEvents=index([...events.values()].filter(row=>row.fund_application_id!==null),'fund_application_id');
  const receivables=index(read('receivable_items'));
  const ordinaryOps=index(history.operation,'operation_id');
  const applicationAudits=index(history.audit_event.filter(row=>row.entity_kind==='customer_fund_applications'&&row.action==='apply'),'operation_id');
  const checkedApplications=new Set<unknown>();
  const operations=index(history.operation.filter(row=>row.command_type===save&&row.state==='committed'),'operation_id');
  const audits=index(history.audit_event.filter(row=>row.entity_kind==='collection_failure_recredits'&&row.action==='recredit'),'operation_id');
  const ranges=new Map<unknown,{first:bigint;last:bigint}[]>();
  const claimedLines=new Set<unknown>();
  const reviewOps=history.operation.filter(row=>row.command_type==='finance.mapping.approve'&&row.state==='committed'
    &&typeof row.result==='string').map(row=>JSON.parse(row.result as string) as Row);
  check([recoveryEvents,recoveryLots,operations,audits].every(found=>found.size===recoveries.size));
  for(const recovery of recoveries.values()){
    const event=recoveryEvents.get(recovery.id),failure=failures.get(recovery.failure_id),part=parts.get(recovery.failure_component_id);
    const original=failure&&originalEvents.get(failure.id),baseLot=part&&lots.get(part.fund_lot_id);
    const lot=event&&recoveryLots.get(event.id),root=lot&&roots.get(lot.origin_id),partition=lot&&parentParts.get(lot.parent_partition_id);
    const payment=failure&&payments.get(failure.payment_id),originalReceipt=failure&&events.get(failure.original_event_id);
    const group=event&&groupsById.get(event.group_id),before=original&&groupsById.get(original.group_id);
    const move=event&&movements.get(event.id),proof=move&&evidence.get(move.evidence_id);
    const op=operations.get(recovery.operation_id),audit=audits.get(recovery.operation_id);
    check(event&&failure&&part&&original&&baseLot&&lot&&root&&partition&&payment&&originalReceipt
      &&group&&before&&move&&proof&&op&&audit);
    const first=cents(recovery.first_cent),last=cents(recovery.last_cent),gross=last-first+1n;
    const available=ranges.get(part.id)??[];
    check(gross>0n&&first>=cents(part.root_first_cent)&&last<=cents(part.root_last_cent)
      &&available.every(span=>last<span.first||first>span.last));
    available.push({first,last});
    ranges.set(part.id,available);
    check(failure.kind==='settled_failure'&&part.collection_failure_id===failure.id&&part.payment_id===payment.id
      &&part.allocation_id===null&&part.fund_application_id===null&&part.tip_realization_id===null
      &&baseLot.collection_failure_recredit_event_id===null&&baseLot.customer_id===recovery.customer_id
      &&lot.customer_id===recovery.customer_id&&lot.origin_id===baseLot.origin_id&&lot.parent_partition_id===baseLot.parent_partition_id
      &&lot.unapplication_id===null&&lot.receipt_event_id===null&&lot.receipt_tip_event_id===null
      &&root.payment_id===payment.id&&root.customer_id===recovery.customer_id&&partition.origin_id===root.id
      &&payment.customer_id===recovery.customer_id&&originalReceipt.payment_id===payment.id&&originalReceipt.template==='P03'
      &&cents(lot.original_cents)===gross&&event.template==='P11'&&event.template_version==='2'&&event.event_sequence==='1'
      &&['invoice_id','payment_id','posted_expense_id','unapplication_id','fund_application_id','tip_realization_id',
        'invoice_credit_id','service_refund_id','excess_return_id','tip_return_id','collection_failure_id','refund_transfer_adjustment_id',
        'zero_effect_reason'].every(key=>event[key]===null)
      &&customerDate(recovery.actual_on)&&customerDate(failure.effective_on)&&recovery.actual_on>=failure.effective_on
      &&event.effective_on===recovery.actual_on&&cents(group.commit_sequence)>cents(before.commit_sequence)
      &&group.operation_id===op.operation_id&&group.recovery_epoch===op.recovery_epoch&&group.created_by===recovery.created_by
      &&op.actor_id===recovery.created_by&&audit.actor_id===op.actor_id&&audit.reason===recovery.reason
      &&audit.entity_id===recovery.id&&String(audit.entity_version)==='1'
      &&financeAccountReviewReason(recovery.confirmation)&&financeAccountReviewReason(recovery.reason)
      &&reviewOps.some(mapping=>mapping.purpose==='customer_funds'&&mapping.id===lot.mapping_id&&mapping.accountId===lot.account_id
        &&customerDate(mapping.effectiveFrom)&&mapping.effectiveFrom<=String(recovery.actual_on))
      &&move.account_id===recovery.money_account_id&&move.evidence_id===recovery.evidence_id&&move.signed_cents===String(gross)
      &&proof.external_account_id===move.account_id&&proof.signed_cents===move.signed_cents&&proof.currency==='USD'
      &&proof.confirmed_on===recovery.actual_on&&proof.normalization_rule==='exact_case_v1');
    const entry=entries.get(event.id);
    check(entry&&entry.entry_sequence==='1');
    const posted=lines.filter(line=>line.entry_id===entry.id);
    const money=posted.find(line=>line.purpose==='collection_recredit_money');
    const funds=posted.find(line=>line.purpose==='collection_recredit_funds');
    check(posted.length===2&&money&&funds&&posted.every(line=>line.collection_failure_recredit_id===recovery.id)
      &&money.account_id===move.account_id&&money.money_movement_id===move.id&&money.fund_lot_id===null
      &&money.fixed_mapping_id===null&&money.debit_cents===String(gross)&&money.credit_cents==='0'
      &&funds.account_id===lot.account_id&&funds.fund_lot_id===lot.id&&funds.fixed_mapping_id===lot.mapping_id
      &&funds.money_movement_id===null&&funds.debit_cents==='0'&&funds.credit_cents===String(gross));
    posted.forEach(line=>claimedLines.add(line.id));
    check(typeof op.result==='string'&&typeof audit.delta==='string');
    const receipt=JSON.parse(op.result) as Row;
    check(customerUuid(receipt.moneyChannelId)&&cents(receipt.moneyChannelVersion)>0n);
    const expected={schemaVersion:1,businessId:recovery.business_id,operationId:op.operation_id,recreditId:recovery.id,
      eventId:event.id,failureId:failure.id,failureComponentId:part.id,originalPaymentId:payment.id,originalEventId:originalReceipt.id,
      customerId:lot.customer_id,fundingOriginId:root.id,previousFundLotId:baseLot.id,fundLotId:lot.id,fundsAccountId:lot.account_id,
      fundsMappingId:lot.mapping_id,moneyAccountId:move.account_id,moneyChannelId:receipt.moneyChannelId,
      moneyChannelVersion:receipt.moneyChannelVersion,moneyMovementId:move.id,evidenceId:proof.id,actualOn:recovery.actual_on,
      firstCent:recovery.first_cent,lastCent:recovery.last_cent,cents:String(gross),confirmation:recovery.confirmation,reason:recovery.reason};
    check(isDeepStrictEqual(receipt,expected)&&isDeepStrictEqual(JSON.parse(audit.delta),{schemaVersion:1,before:null,after:expected}));
    const used=read('fund_lot_range_consumptions').filter(row=>row.fund_lot_id===lot.id);
    check(used.every(row=>customerUuid(row.fund_application_id)));
    let end=first-1n;
    for(const consumption of [...used].sort((a,b)=>cents(a.first_cent)<cents(b.first_cent)?-1:1)){
      const application=applications.get(consumption.fund_application_id);
      const applied=application&&applicationEvents.get(application.id),receivable=application&&receivables.get(application.receivable_id);
      const lower=cents(consumption.first_cent),upper=cents(consumption.last_cent);
      check(application&&applied&&receivable&&application.fund_lot_id===lot.id&&receivable.customer_id===lot.customer_id
        &&lower>end&&upper>=lower&&upper<=last&&application.first_cent===consumption.first_cent&&application.last_cent===consumption.last_cent
        &&customerDate(applied.effective_on)&&applied.effective_on>=recovery.actual_on);
      const appliedGroup=groupsById.get(applied.group_id),appliedEntry=entries.get(applied.id);
      const appliedOp=ordinaryOps.get(application.operation_id),appliedAudit=applicationAudits.get(application.operation_id);
      const amount=String(upper-lower+1n);
      check(appliedGroup&&appliedEntry&&appliedOp&&appliedAudit&&appliedGroup.operation_id===application.operation_id
        &&cents(appliedGroup.commit_sequence)>cents(group.commit_sequence)&&appliedEntry.entry_sequence==='1'
        &&appliedOp.command_type==='finance.funds.apply'&&appliedOp.state==='committed'
        &&typeof appliedOp.result==='string'&&typeof appliedAudit.delta==='string'
        &&appliedAudit.entity_id===application.id&&appliedAudit.reason===application.reason);
      const appliedLines=lines.filter(line=>line.entry_id===appliedEntry.id);
      const ar=appliedLines.find(line=>line.purpose==='apply_ar'), debit=appliedLines.find(line=>line.purpose==='apply_funds');
      check(appliedLines.length===2&&ar&&debit&&appliedLines.every(line=>line.fund_application_id===application.id)
        &&ar.account_id===receivable.account_id&&ar.receivable_id===receivable.id&&ar.debit_cents==='0'&&ar.credit_cents===amount
        &&debit.account_id===lot.account_id&&debit.fund_lot_id===lot.id&&debit.fixed_mapping_id===lot.mapping_id
        &&debit.debit_cents===amount&&debit.credit_cents==='0');
      const paid={schemaVersion:3,businessId:recovery.business_id,fundApplicationId:application.id,operationId:appliedOp.operation_id,
        eventId:applied.id,fundLotId:lot.id,unapplicationId:null,fundingOriginId:root.id,parentPartitionId:lot.parent_partition_id,
        collectionFailureRecreditEventId:event.id,customerId:lot.customer_id,receivableId:receivable.id,invoiceId:receivable.invoice_id,
        arAccountId:receivable.account_id,fundsAccountId:lot.account_id,mappingId:lot.mapping_id,effectiveOn:applied.effective_on,
        firstCent:String(lower),lastCent:String(upper),cents:amount,reason:application.reason};
      check(isDeepStrictEqual(JSON.parse(appliedOp.result),paid)
        &&isDeepStrictEqual(JSON.parse(appliedAudit.delta),{schemaVersion:1,before:null,after:paid}));
      checkedApplications.add(application.id);
      end=upper;
    }
  }
  const recoveredLotIds=new Set([...recoveryLots.values()].map(row=>row.id));
  check([...applications.values()].every(row=>!recoveredLotIds.has(row.fund_lot_id)||checkedApplications.has(row.id)));
  check(lines.every(line=>line.collection_failure_recredit_id===null
    ?line.purpose!=='collection_recredit_money'&&line.purpose!=='collection_recredit_funds':claimedLines.has(line.id)));
  const retired=index(history.operation.filter(row=>row.command_type===retire&&row.state==='committed'),'operation_id');
  const retained=index(history.audit_event.filter(row=>row.entity_kind==='operations'&&row.action==='retire'&&retired.has(row.operation_id)),'operation_id');
  check(retired.size===retained.size);
  for(const [id,op] of retired){
    const audit=retained.get(id);
    check(audit&&audit.entity_id===op.id&&audit.actor_id===op.actor_id&&typeof op.result==='string'&&typeof audit.delta==='string');
    const receipt:unknown=JSON.parse(op.result);
    check(exact(receipt,['schemaVersion','businessId','operationId','recreditId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===op.business_id&&receipt.operationId===id&&customerUuid(receipt.recreditId)
      &&customerUuid(receipt.originalEpoch)&&receipt.reviewEpoch===op.recovery_epoch&&receipt.reason===audit.reason
      &&isDeepStrictEqual(JSON.parse(audit.delta),{schemaVersion:1,before:null,after:receipt}));
  }
}
