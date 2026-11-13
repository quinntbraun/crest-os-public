import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { customerDate, customerInstant, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { readSourceExportCsv } from '../security/source-export-csv-reader.ts';
import { captureInvoiceSource } from './invoice-source.ts';
import { captureUnapplicationSource } from './unapplication-source.ts';

const schema = {
  customer_fund_applications: 'id business_id fund_lot_id receivable_id first_cent last_cent reason operation_id created_by created_at',
  atomic_finance_groups: 'id business_id commit_sequence recovery_epoch created_by operation_id created_at',
  financial_events: 'id business_id group_id event_sequence invoice_id period_id period_generation reopened_generation effective_on time_zone template template_version zero_effect_reason posted_at payment_id posted_expense_id unapplication_id fund_application_id',
  journal_entries: 'id business_id event_id entry_sequence',
  journal_lines: 'id business_id entry_id invoice_item_id receivable_id account_id fixed_mapping_id tax_payable_movement_id purpose debit_cents credit_cents money_movement_id allocation_event_id unapplication_id fund_lot_id fund_application_id',
} as const;
type Group = keyof typeof schema;
type Row = Readonly<Record<string, string | null>>;
type ReferenceRow = Readonly<Record<string, string | boolean | null>>;
type Rows = Record<Group, Row[]>;
type Query = (sql: string, parameters: unknown[]) => Promise<unknown[]>;
type References = Readonly<{
  invoice: Awaited<ReturnType<typeof captureInvoiceSource>>;
  unapplication: Awaited<ReturnType<typeof captureUnapplicationSource>>;
}>;
const groups = Object.freeze(Object.keys(schema) as Group[]);
export const fundApplicationSourceCoverage = Object.freeze([Object.freeze({
  table: 'crest.customer_fund_applications', scope: 'business' as const,
  required: Object.freeze(schema.customer_fund_applications.split(' ')), excluded: Object.freeze([]), partialEvidenceGroup: null,
})]);
export const fundApplicationSourceAddedColumns = Object.freeze({
  'crest.financial_events': Object.freeze(['fund_application_id']),
  'crest.journal_lines': Object.freeze(['fund_application_id']),
});
const nullable: Partial<Record<Group, readonly string[]>> = {
  financial_events: ['invoice_id', 'reopened_generation', 'zero_effect_reason', 'payment_id', 'posted_expense_id', 'unapplication_id'],
  journal_lines: ['invoice_item_id', 'receivable_id', 'fixed_mapping_id', 'tax_payable_movement_id', 'money_movement_id',
    'allocation_event_id', 'unapplication_id', 'fund_lot_id'],
};
const integers = new Set(['first_cent', 'last_cent', 'commit_sequence', 'event_sequence', 'period_generation',
  'reopened_generation', 'template_version', 'entry_sequence']);
const limit = 10_000;
const maxBytes = 16 * 1024 * 1024;
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const token = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const count = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,4})$/.test(value) && Number(value) <= limit;
const cents = (value: ReferenceRow, field: string) => BigInt(String(value[field]));

function requireSource(condition: unknown): asserts condition {
  if (!condition) throw Error('FUND_APPLICATION_SOURCE_REVIEW_REQUIRED');
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

export async function captureFundApplicationSource(businessId: string, query: Query, references?: References) {
  requireSource(customerUuid(businessId));
  let bytes = 0;
  const one = async (sql: string, parameters: unknown[]) => {
    const result = await query(sql, parameters);
    requireSource(Array.isArray(result) && result.length === 1 && exact(result[0], ['result']));
    bytes += Buffer.byteLength(JSON.stringify(result));
    requireSource(bytes <= maxBytes);
    return result[0].result;
  };
  const context = await one('SELECT crest_commands.fund_application_source_snapshot_context($1::uuid) AS result', [businessId]);
  requireSource(exact(context, ['schemaVersion', 'scope', 'businessId', 'snapshotToken', 'historySnapshotToken', 'counts'])
    && context.schemaVersion === 1 && context.scope === 'customer_fund_application_sources' && context.businessId === businessId
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
      const page = await one('SELECT crest_commands.fund_application_source_snapshot_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer) AS result',
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
  const related = references ?? {
    invoice: await captureInvoiceSource(businessId, one),
    unapplication: await captureUnapplicationSource(businessId, query),
  };
  requireSource(related.invoice.businessId === businessId && related.unapplication.businessId === businessId
    && related.invoice.historySnapshotToken === historySnapshotToken && related.unapplication.historySnapshotToken === historySnapshotToken);
  return { businessId, snapshotToken, historySnapshotToken, counts, rows, references: related };
}

function index(rows: readonly ReferenceRow[], field = 'id') {
  const result = new Map(rows.map(row => [row[field], row]));
  requireSource(result.size === rows.length);
  return result;
}

function linked(rows: ReadonlyMap<ReferenceRow[string] | undefined, ReferenceRow>, key: ReferenceRow[string] | undefined) {
  const result = rows.get(key);
  requireSource(result);
  return result;
}

function buckets(rows: readonly Row[], field: string) {
  const result = new Map<Row[string] | undefined, Row[]>();
  for (const row of rows) {
    const entries = result.get(row[field]) ?? [];
    entries.push(row);
    result.set(row[field], entries);
  }
  return result;
}

function verifyClosure(rows: Rows, references: References) {
  const applications = index(rows.customer_fund_applications);
  const groups = index(rows.atomic_finance_groups);
  const events = index(rows.financial_events, 'fund_application_id');
  const journals = index(rows.journal_entries, 'event_id');
  const lines = buckets(rows.journal_lines, 'entry_id');
  const lots = index(references.unapplication.rows.customer_fund_lots);
  const origins = index(references.unapplication.rows.allocation_unapplications);
  const heldEvents = index(references.unapplication.rows.financial_events, 'unapplication_id');
  const heldGroups = index(references.unapplication.rows.atomic_finance_groups);
  const receivables = index(references.invoice.rows.receivable_items);
  const issuedEvents = index(references.invoice.rows.financial_events, 'invoice_id');
  const issuedGroups = index(references.invoice.rows.atomic_finance_groups);
  const history = references.unapplication.history;
  const readHistory = (source: typeof history.operation[number]) => {
    requireSource(source.evidence_hash === digest(source.canonical_evidence));
    return JSON.parse(source.canonical_evidence).row as Row;
  };
  const operations = index(history.operation.map(readHistory), 'operation_id');
  const audits = buckets(history.audit_event.map(readHistory), 'operation_id');
  requireSource(groups.size === applications.size && events.size === applications.size && journals.size === applications.size
    && rows.journal_lines.length === 2 * applications.size);
  const seenGroups = new Set<ReferenceRow[string] | undefined>();
  for (const ranges of buckets(rows.customer_fund_applications, 'fund_lot_id').values()) {
    ranges.sort((a, b) => cents(a, 'first_cent') < cents(b, 'first_cent') ? -1 : 1);
    let previous = 0n;
    for (const application of ranges) {
      const first = cents(application, 'first_cent'), last = cents(application, 'last_cent'), applied = last - first + 1n;
      requireSource(first > previous && applied > 0n);
      previous = last;
      const event = linked(events, application.id), group = linked(groups, event.group_id);
      const lot = linked(lots, application.fund_lot_id), origin = linked(origins, lot.unapplication_id);
      const held = linked(heldEvents, origin.id), heldGroup = linked(heldGroups, held.group_id);
      const receivable = linked(receivables, application.receivable_id), issued = linked(issuedEvents, receivable.invoice_id);
      const issuedGroup = linked(issuedGroups, issued.group_id), entry = linked(journals, event.id);
      requireSource(first >= cents(origin, 'first_cent') && last <= cents(origin, 'last_cent')
        && event.template === 'P04' && event.template_version === '1' && event.event_sequence === '1'
        && event.invoice_id === null && event.payment_id === null && event.posted_expense_id === null
        && event.unapplication_id === null && event.zero_effect_reason === null && cents(event, 'period_generation') % 2n === 0n
        && event.effective_on && held.effective_on && issued.effective_on
        && String(event.effective_on) >= String(held.effective_on) && String(event.effective_on) >= String(issued.effective_on)
        && !seenGroups.has(group.id) && cents(group, 'commit_sequence') > cents(heldGroup, 'commit_sequence')
        && cents(group, 'commit_sequence') > cents(issuedGroup, 'commit_sequence')
        && group.operation_id === application.operation_id && group.created_by === application.created_by
        && lot.customer_id === receivable.customer_id && entry.entry_sequence === '1');
      seenGroups.add(group.id);
      const journal = lines.get(entry.id as string) ?? [];
      requireSource(journal.length === 2 && journal.every(line => line.fund_application_id === application.id
        && line.invoice_item_id === null && line.tax_payable_movement_id === null && line.allocation_event_id === null
        && line.unapplication_id === null && line.money_movement_id === null));
      const ar = journal.find(line => line.purpose === 'apply_ar'), funds = journal.find(line => line.purpose === 'apply_funds');
      requireSource(ar && ar.account_id === receivable.account_id && ar.receivable_id === receivable.id && ar.fund_lot_id === null
        && ar.fixed_mapping_id === null && cents(ar, 'debit_cents') === 0n && cents(ar, 'credit_cents') === applied
        && funds && funds.account_id === lot.account_id && funds.fund_lot_id === lot.id && funds.fixed_mapping_id === lot.mapping_id
        && funds.receivable_id === null && cents(funds, 'debit_cents') === applied && cents(funds, 'credit_cents') === 0n);
      const operation = linked(operations, application.operation_id);
      const audit = (audits.get(application.operation_id) ?? []).filter(row =>
        row.entity_kind === 'customer_fund_applications' && row.entity_id === application.id && row.action === 'apply');
      const receipt = {
        schemaVersion: 1, businessId: application.business_id, fundApplicationId: application.id, operationId: application.operation_id,
        eventId: event.id, fundLotId: lot.id, unapplicationId: origin.id, fundingOriginId: lot.origin_id, parentPartitionId: lot.parent_partition_id,
        customerId: lot.customer_id, receivableId: receivable.id, invoiceId: receivable.invoice_id, arAccountId: ar.account_id,
        fundsAccountId: funds.account_id, mappingId: lot.mapping_id, effectiveOn: event.effective_on, firstCent: application.first_cent,
        lastCent: application.last_cent, cents: applied.toString(), reason: application.reason,
      };
      requireSource(operation.command_type === 'finance.funds.apply' && operation.state === 'committed'
        && operation.actor_id === application.created_by && operation.recovery_epoch === group.recovery_epoch
        && typeof operation.result === 'string' && audit.length === 1 && audit[0]!.actor_id === application.created_by
        && audit[0]!.reason === application.reason && typeof audit[0]!.delta === 'string');
      requireSource(isDeepStrictEqual(JSON.parse(operation.result), receipt)
        && isDeepStrictEqual(JSON.parse(audit[0]!.delta), { schemaVersion: 1, before: null, after: receipt }));
    }
  }
}

export function formatFundApplicationSource(source: Awaited<ReturnType<typeof captureFundApplicationSource>>) {
  const { businessId, snapshotToken, historySnapshotToken, counts, rows, references } = source;
  requireSource(customerUuid(businessId) && token(snapshotToken) && token(historySnapshotToken) && exact(rows, groups) && exact(counts, groups)
    && references.invoice.businessId === businessId && references.unapplication.businessId === businessId
    && references.invoice.historySnapshotToken === historySnapshotToken && references.unapplication.historySnapshotToken === historySnapshotToken);
  verifyClosure(rows, references);
  const files: { name: string; content: string }[] = [];
  let bytes = 0, total = 0;
  const add = (name: string, content: string) => {
    bytes += Buffer.byteLength(content);
    requireSource(bytes <= maxBytes);
    files.push({ name, content });
  };
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  for (const group of groups) {
    const columns = schema[group].split(' ');
    const records = rows[group].map(row => validateRow(row, group, businessId)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    total += records.length;
    requireSource(count(counts[group]) && Number(counts[group]) === records.length && total <= limit);
    index(records);
    const escapes: { row_id: string; column: string; apostrophe_prefix: true }[] = [];
    const csv = [columns.map(quote).join(',')];
    let csvBytes = Buffer.byteLength(csv[0]!) + 2;
    for (const row of records) {
      const line = columns.map(column => {
        const cell = row[column];
        if (cell === null) return quote('\\N');
        let text = cell!.replaceAll('\\', '\\\\');
        if (text.startsWith("'") || /^[=+@-]/.test(text.trimStart())) {
          text = "'" + text;
          escapes.push({ row_id: row.id!, column, apostrophe_prefix: true });
        }
        return quote(text);
      }).join(',');
      csvBytes += Buffer.byteLength(line) + 2;
      requireSource(bytes + csvBytes <= maxBytes);
      csv.push(line);
    }
    const content = csv.join('\r\n') + '\r\n';
    requireSource(isDeepStrictEqual(readSourceExportCsv(content, escapes, { columns, maxRows: limit }), records));
    add(group + '.csv', content);
    add(group + '_escape_map.json', JSON.stringify({ schemaVersion: 1, businessId, snapshotToken, group, escapes }) + '\n');
    add(group + '_dictionary.json', JSON.stringify({ schemaVersion: 1, group, columns, key: 'id', null: '\\N',
      format: 'UTF-8 RFC4180 CRLF', decode: 'Import as text. Apply only mapped apostrophe removals, then unescape paired backslashes. Keep cents and sequences as decimal strings.' }) + '\n');
  }
  const history = references.unapplication.history;
  for (const kind of ['operation', 'audit_event'] as const) {
    add(kind + '_history.ndjson', history[kind].map(row => JSON.stringify(row) + '\n').join(''));
  }
  const manifest = JSON.stringify({ schemaVersion: 1, scope: 'customer_fund_application_sources', businessId, snapshotToken, historySnapshotToken,
    recordCounts: counts, exactFundApplicationEffectsVerified: true, referenceClosureComplete: false, completePortableExport: false, completeBackup: false,
    parts: files.map(({ name, content }) => ({ name, bytes: Buffer.byteLength(content), sha256: digest(content) })) }) + '\n';
  requireSource(bytes + Buffer.byteLength(manifest) <= maxBytes);
  return { files, manifest };
}
