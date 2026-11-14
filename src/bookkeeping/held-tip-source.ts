import { isDeepStrictEqual } from 'node:util';
import { calculateInclusiveFinanceCharge, isFinanceCents, isFinanceDecimalRate } from './finance-inclusive-charge.ts';
import { financeAccountReviewReason } from './finance-account-contract.ts';
import { customerDate, customerInstant, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';

const schema = {
  tip_realizations: 'id business_id fund_lot_id first_cent last_cent inclusive_cents net_cents tax_cents jurisdiction tax_profile_id revenue_mapping_id revenue_account_id tax_mapping_id tax_account_id customer_intent_evidence reason operation_id created_by created_at',
  fund_lot_range_consumptions: 'id business_id fund_lot_id first_cent last_cent fund_application_id tip_realization_id',
  atomic_finance_groups: 'id business_id commit_sequence recovery_epoch created_by operation_id created_at',
  financial_events: 'id business_id group_id event_sequence invoice_id period_id period_generation reopened_generation effective_on time_zone template template_version zero_effect_reason posted_at payment_id posted_expense_id unapplication_id fund_application_id tip_realization_id',
  journal_entries: 'id business_id event_id entry_sequence',
  journal_lines: 'id business_id entry_id invoice_item_id receivable_id account_id fixed_mapping_id tax_payable_movement_id purpose debit_cents credit_cents money_movement_id allocation_event_id unapplication_id fund_lot_id fund_application_id tip_realization_id',
} as const;
type Group = keyof typeof schema;
type Row = Readonly<Record<string, string | null>>;
type Rows = Record<Group, Row[]>;
type Query = (sql: string, parameters: unknown[]) => Promise<unknown[]>;
const groups = Object.freeze(Object.keys(schema) as Group[]);
export const heldTipSourceCoverage = Object.freeze((['tip_realizations','fund_lot_range_consumptions'] as const).map(group=>
  Object.freeze({table:'crest.'+group,scope:'business' as const,required:Object.freeze(schema[group].split(' ')),
    excluded:Object.freeze([]),partialEvidenceGroup:null})));
export const heldTipSourceAddedColumns = Object.freeze({
  'crest.financial_events': Object.freeze(['tip_realization_id']),
  'crest.journal_lines': Object.freeze(['tip_realization_id']),
});
const nullable: Partial<Record<Group, readonly string[]>> = {
  tip_realizations: ['tax_mapping_id','tax_account_id'],
  fund_lot_range_consumptions: ['fund_application_id','tip_realization_id'],
  financial_events: ['invoice_id', 'reopened_generation', 'zero_effect_reason', 'payment_id', 'posted_expense_id', 'unapplication_id','fund_application_id'],
  journal_lines: ['invoice_item_id', 'receivable_id', 'fixed_mapping_id', 'tax_payable_movement_id', 'money_movement_id',
    'allocation_event_id', 'unapplication_id', 'fund_lot_id','fund_application_id'],
};
const integers = new Set(['first_cent', 'last_cent', 'commit_sequence', 'event_sequence', 'period_generation',
  'reopened_generation', 'template_version', 'entry_sequence']);
const limit = 10_000;
const maxBytes = 16 * 1024 * 1024;
const token = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const count = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,4})$/.test(value) && Number(value) <= limit;

function requireSource(condition: unknown): asserts condition {
  if (!condition) throw Error('HELD_TIP_SOURCE_REVIEW_REQUIRED');
}

function validateRow(value: unknown, group: Group, businessId: string): Row {
  const fields = schema[group].split(' ');
  requireSource(exact(value, fields) && value.business_id === businessId);
  for (const field of fields) {
    const cell = value[field];
    if (cell === null && nullable[group]?.includes(field)) continue;
    requireSource(typeof cell === 'string' && !cell.includes('\0') && Buffer.from(cell).toString('utf8') === cell);
    if (field === 'id' || field.endsWith('_id') || field === 'created_by' || field === 'recovery_epoch') {
      requireSource(customerUuid(cell));
    } else if (field.endsWith('_at')) {
      requireSource(customerInstant(cell));
    } else if (field === 'effective_on') {
      requireSource(customerDate(cell));
    } else if (integers.has(field) || field.endsWith('_cents')) {
      requireSource(/^(0|[1-9][0-9]{0,18})$/.test(cell) && BigInt(cell) <= 9223372036854775807n);
    }
  }
  return value as Row;
}

export async function captureHeldTipSource(businessId: string, query: Query) {
  requireSource(customerUuid(businessId));
  let bytes = 0;
  const one = async (sql: string, parameters: unknown[]) => {
    const result = await query(sql, parameters);
    requireSource(Array.isArray(result) && result.length === 1 && exact(result[0], ['result']));
    bytes += Buffer.byteLength(JSON.stringify(result));
    requireSource(bytes <= maxBytes);
    return result[0].result;
  };
  const context = await one('SELECT crest_commands.held_tip_source_snapshot_context($1::uuid) AS result', [businessId]);
  requireSource(exact(context, ['schemaVersion', 'scope', 'businessId', 'snapshotToken', 'historySnapshotToken', 'counts'])
    && context.schemaVersion === 1 && context.scope === 'held_tip_sources' && context.businessId === businessId
    && token(context.snapshotToken) && token(context.historySnapshotToken) && exact(context.counts, groups));
  const { snapshotToken, historySnapshotToken } = context;
  const counts = {} as Record<Group, string>;
  const rows = {} as Rows;
  let total = 0;
  for (const group of groups) {
    const expected = context.counts[group];
    requireSource(count(expected));
    counts[group] = expected;
    total += Number(expected);
    requireSource(total <= limit);
    let after: string | null = null;
    const records: Row[] = [];
    for (;;) {
      const page = await one('SELECT crest_commands.held_tip_source_snapshot_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer) AS result',
        [businessId, snapshotToken, group, after, 20]);
      requireSource(exact(page, ['schemaVersion', 'businessId', 'snapshotToken', 'group', 'rows', 'hasMore'])
        && page.schemaVersion === 1 && page.businessId === businessId && page.snapshotToken === snapshotToken && page.group === group
        && Array.isArray(page.rows) && page.rows.length <= 20 && typeof page.hasMore === 'boolean' && (!page.hasMore || page.rows.length > 0));
      for (const value of page.rows) {
        const row = validateRow(value, group, businessId);
        requireSource(typeof row.id === 'string' && (after === null || row.id > after));
        records.push(row);
        after = row.id;
      }
      requireSource(records.length <= Number(expected));
      if (!page.hasMore) break;
    }
    requireSource(records.length === Number(expected));
    rows[group] = records;
  }
  return { businessId, snapshotToken, historySnapshotToken, counts, rows };
}


type PortableRow=Readonly<Record<string,unknown>>;
type LookupKey=unknown;
function index(rows:readonly PortableRow[],field='id'){
  const result=new Map<LookupKey,PortableRow>();
  for(const row of rows){
    requireSource(customerUuid(row[field])&&!result.has(row[field]));
    result.set(row[field],row);
  }
  return result;
}

function get(index:ReadonlyMap<LookupKey,PortableRow>,key:LookupKey){
  const result=index.get(key);
  requireSource(result);
  return result;
}

function bucket(rows:readonly PortableRow[],field:string){
  const result=new Map<LookupKey,PortableRow[]>();
  for(const row of rows){
    const group=result.get(row[field])??[];
    group.push(row);
    result.set(row[field],group);
  }
  return result;
}

function amount(row:PortableRow,field:string){
  const value=row[field];
  requireSource(isFinanceCents(value));
  return BigInt(value);
}

function parsed(value:unknown):PortableRow{
  requireSource(typeof value==='string');
  const row:unknown=JSON.parse(value);
  requireSource(row!==null&&typeof row==='object'&&!Array.isArray(row));
  return row as PortableRow;
}

function approvalBasis(operations:readonly PortableRow[],command:string){
  const entries=operations.filter(row=>row.command_type===command&&row.state==='committed')
    .map(row=>parsed(row.result));
  return index(entries);
}

// The combined v4 snapshot and the offline verifier both use decoded records
// with history bytes already checked against the history manifest.
export function verifyHeldTipSourceClosure(read:(table:string)=>readonly PortableRow[],
  history:{operation:readonly PortableRow[];audit_event:readonly PortableRow[]}){
  const tips=index(read('tip_realizations'));
  const applications=index(read('customer_fund_applications'));
  const lots=index(read('customer_fund_lots'));
  const ranges=read('fund_lot_range_consumptions');
  const released=index(read('allocation_unapplications'));
  const groups=index(read('atomic_finance_groups'));
  const eventRows=read('financial_events');
  const held=index(eventRows.filter(row=>row.template==='P05'),'unapplication_id');
  const tipEvents=index(eventRows.filter(row=>row.template==='P06'),'tip_realization_id');
  const entries=index(read('journal_entries'),'event_id');
  const lines=read('journal_lines');
  const byEntry=bucket(lines,'entry_id');
  const movements=read('money_movements');
  const allocationRows=read('allocation_events');
  const allocations=index(allocationRows);
  const partitions=index(read('funding_partitions'));
  const roots=index(read('funding_origins'));
  const originalReceivables=index(read('receivable_items'));
  const invoiceTaxes=read('invoice_tax_payable_movements');
  const nonTipEffects=new Set([...movements,...allocationRows,...invoiceTaxes].map(row=>row.event_id));
  const operations=index(history.operation,'operation_id');
  const audits=bucket(history.audit_event,'operation_id');
  const profiles=approvalBasis(history.operation,'finance.tax_profile.approve');
  const revenueMappings=approvalBasis(history.operation,'finance.mapping.approve');
  const taxMappings=index(read('tax_payable_mapping_versions'));
  const consumedApplications=new Set<LookupKey>();
  const consumedTips=new Set<LookupKey>();
  const tipEntries=new Set<LookupKey>();
  const tipGroups=new Set<LookupKey>();
  const openPeriods=index(read('accounting_periods'));
  const locks=bucket(read('accounting_period_locks'),'period_id');
  requireSource(ranges.length===tips.size+applications.size&&tipEvents.size===tips.size);
  for(const spans of bucket(ranges,'fund_lot_id').values()){
    spans.sort((a,b)=>amount(a,'first_cent')<amount(b,'first_cent')?-1:1);
    const lot=get(lots,spans[0]!.fund_lot_id),fromReceipt=lot.unapplication_id===null;
    const parent=fromReceipt?get(partitions,lot.parent_partition_id):get(released,lot.unapplication_id);
    const allocation=fromReceipt?null:get(allocations,parent.allocation_id);
    const partition=allocation?get(partitions,allocation.partition_id):parent;
    const root=get(roots,partition.origin_id);
    if(allocation)requireSource(lot.customer_id===get(originalReceivables,allocation.receivable_id).customer_id);
    const parentFirst=amount(parent,'first_cent'),parentLast=amount(parent,'last_cent');
    requireSource(lot.origin_id===root.id&&lot.parent_partition_id===partition.id&&lot.customer_id===root.customer_id
      &&parentFirst>=amount(partition,'first_cent')
      &&parentLast<=amount(partition,'last_cent')&&parentLast>=parentFirst
      &&amount(lot,'original_cents')===parentLast-parentFirst+1n);
    let previous=0n;
    for(const range of spans){
      const first=amount(range,'first_cent'),last=amount(range,'last_cent');
      requireSource(first>previous&&last>=first&&first>=parentFirst&&last<=parentLast
        &&(range.fund_application_id===null)!==(range.tip_realization_id===null));
      previous=last;
      if(range.fund_application_id!==null){
        const application=get(applications,range.fund_application_id);
        requireSource(!consumedApplications.has(application.id)&&range.fund_lot_id===application.fund_lot_id
          &&range.first_cent===application.first_cent&&range.last_cent===application.last_cent);
        consumedApplications.add(application.id);
        continue;
      }
      requireSource(!fromReceipt);
      const tip=get(tips,range.tip_realization_id), event=get(tipEvents,tip.id);
      const source=get(held,parent.id), group=get(groups,event.group_id), sourceGroup=get(groups,source.group_id);
      const period=get(openPeriods,event.period_id);
      const generation=amount(event,'period_generation');
      requireSource(!consumedTips.has(tip.id)&&range.fund_lot_id===tip.fund_lot_id&&range.first_cent===tip.first_cent
        &&range.last_cent===tip.last_cent&&last-first+1n===amount(tip,'inclusive_cents')
        &&event.template_version==='1'&&event.event_sequence==='1'&&event.invoice_id===null&&event.payment_id===null
        &&event.posted_expense_id===null&&event.unapplication_id===null&&event.fund_application_id===null&&event.zero_effect_reason===null
        &&customerDate(event.effective_on)&&customerDate(source.effective_on)&&event.effective_on>=source.effective_on
        &&customerInstant(event.posted_at)&&customerInstant(tip.created_at)&&event.posted_at>=tip.created_at
        &&event.time_zone===period.time_zone&&customerDate(period.starts_on)&&customerDate(period.through_on)
        &&event.effective_on>=period.starts_on&&event.effective_on<=period.through_on
        &&generation%2n===0n&&(generation===0n||(locks.get(period.id)??[]).some(lock=>
          lock.generation===event.period_generation&&lock.state==='reopened'))
        &&amount(group,'commit_sequence')>amount(sourceGroup,'commit_sequence')
        &&!tipGroups.has(group.id)&&group.operation_id===tip.operation_id&&group.created_by===tip.created_by&&!nonTipEffects.has(event.id));
      consumedTips.add(tip.id);
      tipGroups.add(group.id);
      const profile=get(profiles,tip.tax_profile_id), revenue=get(revenueMappings,tip.revenue_mapping_id);
      requireSource(profile.synthetic===true&&profile.applicability==='tip'&&profile.serviceId===null
        &&profile.businessId===tip.business_id&&profile.jurisdiction===tip.jurisdiction
        &&customerDate(profile.effectiveFrom)&&profile.effectiveFrom<=event.effective_on
        &&financeAccountReviewReason(profile.verificationEvidence)&&financeAccountReviewReason(tip.customer_intent_evidence)
        &&financeAccountReviewReason(tip.reason)&&revenue.purpose==='tips_revenue'&&revenue.accountId===tip.revenue_account_id
        &&customerDate(revenue.effectiveFrom)&&revenue.effectiveFrom<=event.effective_on);
      let rate='0';
      if(profile.treatment==='inclusive_single'){
        requireSource(isFinanceDecimalRate(profile.rate)&&profile.rate!=='0'&&customerUuid(tip.tax_account_id));
        rate=profile.rate;
        const tax=get(taxMappings,tip.tax_mapping_id);
        requireSource(tax.account_id===tip.tax_account_id&&tax.jurisdiction===tip.jurisdiction
          &&customerDate(tax.effective_from)&&tax.effective_from<=event.effective_on);
      }else{
        requireSource(profile.treatment==='non_taxable'&&profile.rate===null&&tip.tax_account_id===null&&tip.tax_mapping_id===null);
      }
      requireSource(isFinanceCents(tip.inclusive_cents));
      const charge=calculateInclusiveFinanceCharge(tip.inclusive_cents,'0',rate);
      requireSource(tip.net_cents===charge.netCents&&tip.tax_cents===charge.taxCents
        &&tip.revenue_account_id!==lot.account_id&&tip.tax_account_id!==lot.account_id&&tip.tax_account_id!==tip.revenue_account_id);

      const entry=get(entries,event.id), journal=byEntry.get(entry.id)??[];
      tipEntries.add(entry.id);
      requireSource(entry.entry_sequence==='1'&&journal.length===1+Number(charge.netCents!=='0')+Number(charge.taxCents!=='0')
        &&journal.every(line=>line.tip_realization_id===tip.id&&line.invoice_item_id===null&&line.receivable_id===null
          &&line.tax_payable_movement_id===null&&line.money_movement_id===null&&line.allocation_event_id===null
          &&line.unapplication_id===null&&line.fund_application_id===null));
      const funds=journal.find(line=>line.purpose==='tip_funds'), earned=journal.find(line=>line.purpose==='tip_revenue');
      const payable=journal.find(line=>line.purpose==='tip_tax');
      requireSource(funds?.fund_lot_id===lot.id&&funds?.fixed_mapping_id===lot.mapping_id&&funds?.account_id===lot.account_id
        &&funds?.debit_cents===tip.inclusive_cents&&funds.credit_cents==='0');
      requireSource(charge.netCents==='0'?!earned:earned?.fund_lot_id===null&&earned.fixed_mapping_id===tip.revenue_mapping_id
        &&earned.account_id===tip.revenue_account_id&&earned.debit_cents==='0'&&earned.credit_cents===charge.netCents);
      requireSource(charge.taxCents==='0'?!payable:payable?.fund_lot_id===null&&payable.fixed_mapping_id===null
        &&payable.account_id===tip.tax_account_id&&payable.debit_cents==='0'&&payable.credit_cents===charge.taxCents);
      const operation=get(operations,tip.operation_id);
      const related=(audits.get(tip.operation_id)??[]).filter(row=>row.entity_kind==='tip_realizations'&&row.entity_id===tip.id&&row.action==='realize');
      const receipt={
        schemaVersion:1,businessId:tip.business_id,tipRealizationId:tip.id,operationId:tip.operation_id,eventId:event.id,
        fundLotId:lot.id,unapplicationId:parent.id,fundingOriginId:lot.origin_id,parentPartitionId:lot.parent_partition_id,
        customerId:lot.customer_id,fundsAccountId:lot.account_id,fundsMappingId:lot.mapping_id,revenueAccountId:tip.revenue_account_id,
        revenueMappingId:tip.revenue_mapping_id,taxAccountId:tip.tax_account_id,taxMappingId:tip.tax_mapping_id,taxProfileId:tip.tax_profile_id,
        jurisdiction:tip.jurisdiction,effectiveOn:event.effective_on,firstCent:tip.first_cent,lastCent:tip.last_cent,
        inclusiveCents:tip.inclusive_cents,netCents:tip.net_cents,taxCents:tip.tax_cents,customerIntentEvidence:tip.customer_intent_evidence,reason:tip.reason,
      };
      requireSource(operation.command_type==='finance.tip.realize'&&operation.state==='committed'&&operation.actor_id===tip.created_by
        &&operation.recovery_epoch===group.recovery_epoch&&isDeepStrictEqual(parsed(operation.result),receipt)
        &&related.length===1&&related[0]!.actor_id===tip.created_by&&related[0]!.entity_version==='1'&&related[0]!.reason===tip.reason
        &&isDeepStrictEqual(parsed(related[0]!.delta),{schemaVersion:1,before:null,after:receipt}));
    }
  }
  requireSource(consumedApplications.size===applications.size&&consumedTips.size===tips.size
    &&eventRows.every(event=>event.template==='P06'||event.tip_realization_id===null)
    &&lines.every(line=>line.tip_realization_id===null||tipEntries.has(line.entry_id)));
}
