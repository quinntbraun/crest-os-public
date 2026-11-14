import { isDeepStrictEqual } from 'node:util';
import { isFinanceCents } from './finance-inclusive-charge.ts';
import { creditRangeComponents } from './credit-ranges.ts';
import { financeAccountReviewReason } from './finance-account-contract.ts';
import { customerDate, customerInstant, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';

const schema = {
  invoice_credits: 'id business_id invoice_item_id receivable_id first_cent last_cent inclusive_cents net_cents tax_cents discount_cents returns_cents returns_mapping_id returns_account_id tax_account_id original_tax_movement_id discount_mapping_id discount_account_id reason operation_id created_by created_at',
  atomic_finance_groups: 'id business_id commit_sequence recovery_epoch created_by operation_id created_at',
  financial_events: 'id business_id group_id event_sequence invoice_id period_id period_generation reopened_generation effective_on time_zone template template_version zero_effect_reason posted_at payment_id posted_expense_id unapplication_id fund_application_id tip_realization_id invoice_credit_id',
  journal_entries: 'id business_id event_id entry_sequence',
  journal_lines: 'id business_id entry_id invoice_item_id receivable_id account_id fixed_mapping_id tax_payable_movement_id purpose debit_cents credit_cents money_movement_id allocation_event_id unapplication_id fund_lot_id fund_application_id tip_realization_id invoice_credit_id',
} as const;
type Group = keyof typeof schema;
type Row = Readonly<Record<string, string | null>>;
type Rows = Record<Group, Row[]>;
type Query = (sql: string, parameters: unknown[]) => Promise<unknown[]>;
const groups = Object.freeze(Object.keys(schema) as Group[]);
export const invoiceCreditSourceCoverage = Object.freeze((['invoice_credits'] as const).map(group=>
  Object.freeze({table:'crest.'+group,scope:'business' as const,required:Object.freeze(schema[group].split(' ')),
    excluded:Object.freeze([]),partialEvidenceGroup:null})));
export const invoiceCreditSourceAddedColumns = Object.freeze({
  'crest.financial_events': Object.freeze(['invoice_credit_id']),
  'crest.journal_lines': Object.freeze(['invoice_credit_id']),
});
const nullable: Partial<Record<Group, readonly string[]>> = {
  invoice_credits: ['tax_account_id','original_tax_movement_id','discount_mapping_id','discount_account_id'],
  financial_events: ['invoice_id', 'reopened_generation', 'zero_effect_reason', 'payment_id', 'posted_expense_id', 'unapplication_id','fund_application_id','tip_realization_id'],
  journal_lines: ['invoice_item_id', 'receivable_id', 'fixed_mapping_id', 'tax_payable_movement_id', 'money_movement_id',
    'allocation_event_id', 'unapplication_id', 'fund_lot_id','fund_application_id','tip_realization_id'],
};
const integers = new Set(['first_cent', 'last_cent', 'commit_sequence', 'event_sequence', 'period_generation',
  'reopened_generation', 'template_version', 'entry_sequence']);
const limit = 10_000;
const maxBytes = 16 * 1024 * 1024;
const token = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const count = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,4})$/.test(value) && Number(value) <= limit;

function requireSource(condition: unknown): asserts condition {
  if (!condition) throw Error('INVOICE_CREDIT_SOURCE_REVIEW_REQUIRED');
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

export async function captureInvoiceCreditSource(businessId: string, query: Query) {
  requireSource(customerUuid(businessId));
  let bytes = 0;
  const one = async (sql: string, parameters: unknown[]) => {
    const result = await query(sql, parameters);
    requireSource(Array.isArray(result) && result.length === 1 && exact(result[0], ['result']));
    bytes += Buffer.byteLength(JSON.stringify(result));
    requireSource(bytes <= maxBytes);
    return result[0].result;
  };
  const context = await one('SELECT crest_commands.invoice_credit_source_snapshot_context($1::uuid) AS result', [businessId]);
  requireSource(exact(context, ['schemaVersion', 'scope', 'businessId', 'snapshotToken', 'historySnapshotToken', 'counts'])
    && context.schemaVersion === 1 && context.scope === 'invoice_credit_sources' && context.businessId === businessId
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
      const page = await one('SELECT crest_commands.invoice_credit_source_snapshot_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer) AS result',
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

// Combined source and offline inspection use the same exact charge ancestry.
export function verifyInvoiceCreditSourceClosure(read:(table:string)=>readonly PortableRow[],
  history:{operation:readonly PortableRow[];audit_event:readonly PortableRow[]}){
  const credits=index(read('invoice_credits'));
  const items=index(read('invoice_items')), receivables=index(read('receivable_items')), invoices=index(read('invoices'));
  const groups=index(read('atomic_finance_groups')), events=read('financial_events');
  const issued=index(events.filter(row=>row.template==='P01'||row.template==='P02'),'invoice_id');
  const creditEvents=index(events.filter(row=>row.template==='P07'),'invoice_credit_id');
  const entries=index(read('journal_entries'),'event_id'), lines=read('journal_lines'), byEntry=bucket(lines,'entry_id');
  const originalTax=index(read('invoice_tax_payable_movements'));
  const fundsExcluded=new Set([...read('money_movements'),...read('allocation_events'),...originalTax.values()].map(row=>row.event_id));
  const operations=index(history.operation,'operation_id'), audits=bucket(history.audit_event,'operation_id');
  const mappings=index(history.operation.filter(row=>row.command_type==='finance.mapping.approve'&&row.state==='committed')
    .map(row=>parsed(row.result)));
  const periods=index(read('accounting_periods')), locks=bucket(read('accounting_period_locks'),'period_id');
  const seenEntries=new Set<LookupKey>(), seenGroups=new Set<LookupKey>();
  requireSource(credits.size===creditEvents.size);
  for(const siblings of bucket([...credits.values()],'invoice_item_id').values()){
    siblings.sort((a,b)=>amount(a,'first_cent')<amount(b,'first_cent')?-1:1);
    let previous=0n, previousSequence=0n;
    for(const credit of siblings){
      const item=get(items,credit.invoice_item_id), r=get(receivables,credit.receivable_id), invoice=get(invoices,item.invoice_id);
      const original=get(issued,invoice.id), originalGroup=get(groups,original.group_id), event=get(creditEvents,credit.id), group=get(groups,event.group_id);
      const period=get(periods,event.period_id), generation=amount(event,'period_generation'), sequence=amount(group,'commit_sequence');
      const first=amount(credit,'first_cent'),last=amount(credit,'last_cent');
      requireSource(first===previous+1n&&last>=first&&last<=amount(item,'total_cents')&&sequence>previousSequence);
      previous=last;
      previousSequence=sequence;
      const components=creditRangeComponents({inclusiveCents:amount(item,'total_cents'),netCents:amount(item,'net_cents'),
        taxCents:amount(item,'tax_cents'),discountCents:amount(item,'discount_net_cents')},[{first,last}]);
      const {inclusiveCents,netCents,taxCents,discountCents}=components;
      const returnsCents=netCents+discountCents;
      requireSource(original.template==='P01'&&r.invoice_id===invoice.id&&r.customer_id===invoice.customer_id
        &&amount(credit,'inclusive_cents')===inclusiveCents&&amount(credit,'net_cents')===netCents
        &&amount(credit,'tax_cents')===taxCents&&amount(credit,'discount_cents')===discountCents&&amount(credit,'returns_cents')===returnsCents
        &&event.template_version==='1'&&event.event_sequence==='1'&&event.invoice_id===null&&event.payment_id===null
        &&event.posted_expense_id===null&&event.unapplication_id===null&&event.fund_application_id===null
        &&event.tip_realization_id===null&&event.zero_effect_reason===null&&customerDate(event.effective_on)
        &&customerDate(original.effective_on)&&event.effective_on>=original.effective_on&&customerInstant(event.posted_at)
        &&customerInstant(credit.created_at)&&event.posted_at>=credit.created_at&&event.time_zone===period.time_zone
        &&customerDate(period.starts_on)&&customerDate(period.through_on)&&event.effective_on>=period.starts_on&&event.effective_on<=period.through_on
        &&generation%2n===0n&&(generation===0n||(locks.get(period.id)??[]).some(lock=>lock.generation===event.period_generation&&lock.state==='reopened'))
        &&sequence>amount(originalGroup,'commit_sequence')&&!seenGroups.has(group.id)&&group.operation_id===credit.operation_id
        &&group.created_by===credit.created_by&&!fundsExcluded.has(event.id)&&financeAccountReviewReason(credit.reason));
      seenGroups.add(group.id);
      const returns=get(mappings,credit.returns_mapping_id);
      requireSource(returns.purpose==='returns'&&returns.accountId===credit.returns_account_id
        &&customerDate(returns.effectiveFrom)&&returns.effectiveFrom<=event.effective_on);
      if(taxCents>0n){
        const movement=get(originalTax,credit.original_tax_movement_id);
        requireSource(movement.event_id===original.id&&movement.invoice_item_id===item.id
          &&movement.account_id===credit.tax_account_id&&movement.tax_profile_id===item.tax_profile_id);
      }else requireSource(credit.original_tax_movement_id===null&&credit.tax_account_id===null);
      if(discountCents>0n){
        const originalEntry=get(entries,original.id);
        const originalDiscount=(byEntry.get(originalEntry.id)??[]).filter(line=>line.invoice_item_id===item.id&&line.purpose==='discount');
        requireSource(originalDiscount.length===1&&originalDiscount[0]!.account_id===credit.discount_account_id
          &&originalDiscount[0]!.fixed_mapping_id===credit.discount_mapping_id);
      }else requireSource(credit.discount_account_id===null&&credit.discount_mapping_id===null);
      const entry=get(entries,event.id), journal=byEntry.get(entry.id)??[];
      seenEntries.add(entry.id);
      requireSource(entry.entry_sequence==='1'&&journal.length===1+Number(returnsCents>0n)+Number(taxCents>0n)+Number(discountCents>0n)
        &&journal.every(line=>line.invoice_credit_id===credit.id&&line.invoice_item_id===null&&line.tax_payable_movement_id===null
          &&line.money_movement_id===null&&line.allocation_event_id===null&&line.unapplication_id===null&&line.fund_lot_id===null
          &&line.fund_application_id===null&&line.tip_realization_id===null));
      const expected=[
        ['credit_ar',r.account_id,r.id,null,0n,inclusiveCents],
        ['credit_returns',credit.returns_account_id,null,credit.returns_mapping_id,returnsCents,0n],
        ['credit_tax',credit.tax_account_id,null,null,taxCents,0n],
        ['credit_discount',credit.discount_account_id,null,credit.discount_mapping_id,0n,discountCents],
      ] as const;
      for(const [purpose,accountId,receivableId,mappingId,debit,creditCents] of expected){
        const match=journal.filter(line=>line.purpose===purpose);
        requireSource(debit+creditCents===0n?match.length===0:match.length===1&&match[0]!.account_id===accountId
          &&match[0]!.receivable_id===receivableId&&match[0]!.fixed_mapping_id===mappingId
          &&match[0]!.debit_cents===String(debit)&&match[0]!.credit_cents===String(creditCents));
      }
      const operation=get(operations,credit.operation_id);
      const related=(audits.get(credit.operation_id)??[]).filter(row=>row.entity_kind==='invoice_credits'&&row.entity_id===credit.id&&row.action==='credit');
      const receipt={schemaVersion:1,businessId:credit.business_id,invoiceCreditId:credit.id,operationId:credit.operation_id,
        eventId:event.id,invoiceId:invoice.id,invoiceItemId:item.id,receivableId:r.id,customerId:r.customer_id,arAccountId:r.account_id,
        returnsAccountId:credit.returns_account_id,returnsMappingId:credit.returns_mapping_id,taxAccountId:credit.tax_account_id,
        originalTaxMovementId:credit.original_tax_movement_id,discountAccountId:credit.discount_account_id,discountMappingId:credit.discount_mapping_id,
        effectiveOn:event.effective_on,firstCent:credit.first_cent,lastCent:credit.last_cent,inclusiveCents:credit.inclusive_cents,
        netCents:credit.net_cents,taxCents:credit.tax_cents,discountCents:credit.discount_cents,returnsCents:credit.returns_cents,reason:credit.reason};
      requireSource(operation.command_type==='finance.invoice.credit'&&operation.state==='committed'&&operation.actor_id===credit.created_by
        &&operation.recovery_epoch===group.recovery_epoch&&isDeepStrictEqual(parsed(operation.result),receipt)
        &&related.length===1&&related[0]!.actor_id===credit.created_by&&related[0]!.entity_version==='1'&&related[0]!.reason===credit.reason
        &&isDeepStrictEqual(parsed(related[0]!.delta),{schemaVersion:1,before:null,after:receipt}));
    }
  }
  requireSource(events.every(event=>event.template==='P07'||event.invoice_credit_id===null)
    &&lines.every(line=>line.invoice_credit_id===null||seenEntries.has(line.entry_id)));
}
