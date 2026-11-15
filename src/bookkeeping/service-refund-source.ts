import {createHash} from 'node:crypto';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const refundColumns=['id','business_id','pair_id','fund_lot_id','first_cent','last_cent','cents','channel_version_id',
  'account_id','evidence_id','actual_on','confirmation','reason','operation_id','created_by','created_at'] as const;
const groups=['service_credit_refunds','fund_lot_range_consumptions','financial_events','atomic_finance_groups',
  'journal_entries','journal_lines','money_movements','external_money_evidence'] as const;
type Group=typeof groups[number];
type Cell=string|null;
type SourceRow=Readonly<Record<string,Cell>>;
type Row=Readonly<Record<string,unknown>>;
const digest=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
const isToken=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function check(value:unknown):asserts value{
  if(!value)throw Error('SERVICE_REFUND_SOURCE_REVIEW_REQUIRED');
}

export const serviceRefundSourceCoverage=Object.freeze({
  table:'crest.service_credit_refunds',scope:'business' as const,required:refundColumns,excluded:[],partialEvidenceGroup:null,
});
export const serviceRefundSourceAddedColumns=Object.freeze({
  'crest.financial_events':['service_refund_id'],
  'crest.journal_lines':['service_refund_id'],
  'crest.fund_lot_range_consumptions':['service_refund_id'],
});

export async function captureServiceRefundSource(businessId:string,query:(sql:string,args:unknown[])=>Promise<unknown[]>){
  check(customerUuid(businessId));
  const result=await query('SELECT crest_commands.service_refund_source_snapshot($1::uuid) AS result',[businessId]);
  check(result.length===1&&exact(result[0],['result']));
  const snapshot=result[0].result;
  check(exact(snapshot,['schemaVersion','businessId','historySnapshotToken','rows'])&&snapshot.schemaVersion===1
    &&snapshot.businessId===businessId&&isToken(snapshot.historySnapshotToken)&&exact(snapshot.rows,groups)
    &&Buffer.byteLength(JSON.stringify(snapshot))<=4*1024*1024+512);
  const rows={} as Record<Group,readonly SourceRow[]>;
  let count=0;
  for(const group of groups){
    const page=snapshot.rows[group];
    check(Array.isArray(page));
    count+=page.length;
    check(count<=1000);
    let last='';
    rows[group]=page.map((row:unknown)=>{
      check(row!==null&&typeof row==='object'&&!Array.isArray(row)&&'id' in row&&customerUuid(row.id)&&row.id>last
        &&'business_id' in row&&row.business_id===businessId&&Object.values(row).every(cell=>cell===null||typeof cell==='string'));
      last=row.id;
      return row as SourceRow;
    });
  }
  return {rows,historySnapshotToken:snapshot.historySnapshotToken,
    snapshotToken:digest('crest.service-refund-source.v1:'+snapshot.historySnapshotToken)};
}

export function verifyServiceRefundSourceClosure(read:(group:string)=>readonly Row[],
  history:Readonly<{operation:readonly Row[];audit_event:readonly Row[]}>){
  const index=(rows:readonly Row[],key='id')=>{
    const byKey=new Map(rows.map(row=>[row[key],row]));
    check(byKey.size===rows.length);
    return byKey;
  };
  const refunds=read('service_credit_refunds'),pairs=index(read('paired_invoice_credit_releases'));
  const lots=index(read('customer_fund_lots')),unapplications=index(read('allocation_unapplications'));
  const ranges=index(read('fund_lot_range_consumptions').filter(row=>row.service_refund_id!==null),'service_refund_id');
  const rangesByLot=new Map<unknown,Row[]>();
  for(const range of read('fund_lot_range_consumptions')){
    const portions=rangesByLot.get(range.fund_lot_id)??[];
    portions.push(range);rangesByLot.set(range.fund_lot_id,portions);
  }
  const events=read('financial_events'),outflows=index(events.filter(row=>row.template==='P08'),'service_refund_id');
  const creditEvents=index(events.filter(row=>row.template==='P07'),'invoice_credit_id');
  const groupsById=index(read('atomic_finance_groups')),movement=index(read('money_movements'),'event_id');
  const evidence=index(read('external_money_evidence')),operations=index(history.operation,'operation_id');
  const entries=read('journal_entries'),lines=read('journal_lines'),seen=new Set<unknown>();
  const cents=(value:unknown)=>{check(isFinanceCents(value));return BigInt(value);};
  check(outflows.size===refunds.length&&ranges.size===refunds.length);
  for(const refund of refunds){
    const pair=pairs.get(refund.pair_id),lot=lots.get(refund.fund_lot_id),range=ranges.get(refund.id),event=outflows.get(refund.id);
    check(pair&&lot&&range&&event&&lot.unapplication_id===pair.unapplication_id
      &&range.fund_lot_id===lot.id&&range.first_cent===refund.first_cent&&range.last_cent===refund.last_cent
      &&range.fund_application_id===null&&range.tip_realization_id===null);
    const released=unapplications.get(pair.unapplication_id),credit=creditEvents.get(pair.invoice_credit_id);
    const group=groupsById.get(event.group_id),sourceGroup=credit&&groupsById.get(credit.group_id);
    check(released&&credit&&group&&sourceGroup&&group.operation_id===refund.operation_id&&group.created_by===refund.created_by
      &&cents(group.commit_sequence)>cents(sourceGroup.commit_sequence)&&typeof event.effective_on==='string'
      &&typeof credit.effective_on==='string'&&event.effective_on===refund.actual_on&&event.effective_on>=credit.effective_on
      &&event.event_sequence==='1'&&event.template_version==='1'&&event.zero_effect_reason===null);
    const first=cents(refund.first_cent),last=cents(refund.last_cent),amount=cents(refund.cents);
    check(amount>0n&&amount===last-first+1n&&first>=cents(released.first_cent)&&last<=cents(released.last_cent));
    check(rangesByLot.get(lot.id)?.every(other=>other.id===range.id
      ||cents(other.last_cent)<first||cents(other.first_cent)>last));
    const money=movement.get(event.id),proof=money&&evidence.get(money.evidence_id);
    check(money&&proof&&money.account_id===refund.account_id&&money.evidence_id===refund.evidence_id
      &&proof.external_account_id===refund.account_id&&proof.confirmed_on===refund.actual_on&&proof.currency==='USD'
      &&proof.signed_cents===String(-amount)&&money.signed_cents===proof.signed_cents);
    const journal=entries.filter(entry=>entry.event_id===event.id);
    check(journal.length===1&&journal[0]!.entry_sequence==='1');
    const posted=lines.filter(line=>line.entry_id===journal[0]!.id);
    check(posted.length===2&&posted.every(line=>line.service_refund_id===refund.id));
    const debit=posted.find(line=>line.purpose==='refund_funds'),creditLine=posted.find(line=>line.purpose==='refund_money');
    check(debit&&creditLine&&debit.fund_lot_id===lot.id&&debit.account_id===lot.account_id
      &&debit.fixed_mapping_id===lot.mapping_id&&debit.debit_cents===refund.cents&&debit.credit_cents==='0'
      &&creditLine.money_movement_id===money.id&&creditLine.account_id===money.account_id
      &&creditLine.credit_cents===refund.cents&&creditLine.debit_cents==='0');
    posted.forEach(line=>seen.add(line.id));
    const operation=operations.get(refund.operation_id);
    const audits=history.audit_event.filter(audit=>audit.operation_id===refund.operation_id&&audit.entity_kind==='service_credit_refunds'
      &&audit.entity_id===refund.id&&audit.action==='record_refund');
    check(operation&&operation.command_type==='finance.refund.record_service'&&operation.state==='committed'
      &&operation.actor_id===refund.created_by&&audits.length===1&&audits[0]!.reason===refund.reason);
    check(typeof operation.result==='string'&&typeof audits[0]!.delta==='string');
    const receipt:unknown=JSON.parse(operation.result),audit:unknown=JSON.parse(audits[0]!.delta);
    check(exact(audit,['schemaVersion','before','after'])&&audit.schemaVersion===1&&audit.before===null
      &&JSON.stringify(audit.after)===JSON.stringify(receipt)&&receipt!==null&&typeof receipt==='object'
      &&'serviceRefundId' in receipt&&receipt.serviceRefundId===refund.id&&'pairedCreditId' in receipt&&receipt.pairedCreditId===pair.invoice_credit_id
      &&'eventId' in receipt&&receipt.eventId===event.id&&'cents' in receipt&&receipt.cents===refund.cents);
  }
  check(events.every(event=>event.template==='P08'||event.service_refund_id===null)
    &&lines.every(line=>line.service_refund_id===null||seen.has(line.id)));
}
