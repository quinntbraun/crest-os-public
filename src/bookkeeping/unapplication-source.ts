import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { customerDate, customerInstant, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { readSourceExportCsv } from '../security/source-export-csv-reader.ts';

const schema = {
  allocation_unapplications: 'id business_id allocation_id first_cent last_cent reason operation_id created_by created_at',
  customer_fund_lots: 'id business_id unapplication_id origin_id parent_partition_id customer_id account_id mapping_id original_cents',
  atomic_finance_groups: 'id business_id commit_sequence recovery_epoch created_by operation_id created_at',
  financial_events: 'id business_id group_id event_sequence invoice_id period_id period_generation reopened_generation effective_on time_zone template template_version zero_effect_reason posted_at payment_id posted_expense_id unapplication_id',
  journal_entries: 'id business_id event_id entry_sequence',
  journal_lines: 'id business_id entry_id invoice_item_id receivable_id account_id fixed_mapping_id tax_payable_movement_id purpose debit_cents credit_cents money_movement_id allocation_event_id unapplication_id fund_lot_id',
} as const;
type Group = keyof typeof schema;
type Row = Record<string, string | null>;
type Rows = Record<Group, Row[]>;
type HistoryRow = { record_id: string; representation: 'snapshot_projection'; canonical_evidence: string; evidence_hash: string };
const groups = Object.freeze(Object.keys(schema) as Group[]);
export const unapplicationSourceCoverage = Object.freeze((['allocation_unapplications', 'customer_fund_lots'] as const).map(group =>
  Object.freeze({table: 'crest.' + group, scope: 'business' as const, required: Object.freeze(schema[group].split(' ')),
    excluded: Object.freeze([]), partialEvidenceGroup: null})));
export const unapplicationSourceAddedColumns = Object.freeze({
  'crest.financial_events': Object.freeze(['unapplication_id']),
  'crest.journal_lines': Object.freeze(['unapplication_id', 'fund_lot_id']),
});
const nullable: Partial<Record<Group, readonly string[]>> = {
  financial_events: ['invoice_id', 'payment_id', 'posted_expense_id', 'reopened_generation', 'zero_effect_reason'],
  journal_lines: ['invoice_item_id', 'receivable_id', 'fixed_mapping_id', 'tax_payable_movement_id', 'money_movement_id', 'allocation_event_id', 'fund_lot_id'],
};
const exactDates = new Set(['effective_on']);
const exactInts = new Set(['first_cent', 'last_cent', 'commit_sequence', 'event_sequence',
  'period_generation', 'reopened_generation', 'template_version', 'entry_sequence', 'cents']);
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const token = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,4})$/.test(value) && Number(value) <= 10_000;
const amount = (value: Row, key: string) => BigInt(value[key]!);
const wireLimit = 16 * 1024 * 1024;

function requireSource(condition: unknown): asserts condition {
  if (!condition) throw Error('UNAPPLICATION_SOURCE_REVIEW_REQUIRED');
}

function validateRow(value: unknown, group: Group, businessId: string): Row {
  const fields = schema[group].split(' ');
  requireSource(exact(value, fields) && value.business_id === businessId);
  for (const field of fields) {
    const cell = value[field];
    if (cell === null && nullable[group]?.includes(field)) continue;
    requireSource(typeof cell === 'string' && !cell.includes('\0') && Buffer.from(cell).toString('utf8') === cell);
    if ((field === 'id' || field.endsWith('_id')) || field === 'created_by' || field === 'recovery_epoch') {
      requireSource(customerUuid(cell));
    }
    if (field === 'created_at' || field === 'posted_at') requireSource(customerInstant(cell));
    if (exactDates.has(field)) requireSource(customerDate(cell));
    if (exactInts.has(field) || field.endsWith('_cents')) {
      requireSource(/^(0|-?[1-9][0-9]{0,18})$/.test(cell) && BigInt(cell) >= -9223372036854775808n && BigInt(cell) <= 9223372036854775807n);
    }
  }
  return value as Row;
}

type Query = (sql: string, parameters: unknown[]) => Promise<unknown[]>;
export async function captureUnapplicationSource(businessId: string, query: Query) {
  requireSource(customerUuid(businessId));
  let bytes = 0;
  const run = async (sql: string, parameters: unknown[]) => {
    const result = await query(sql, parameters);
    requireSource(Array.isArray(result));
    bytes += Buffer.byteLength(JSON.stringify(result));
    requireSource(bytes <= wireLimit);
    return result;
  };
  const one = async (sql: string, parameters: unknown[]) => {
    const result = await run(sql, parameters);
    requireSource(result.length === 1 && exact(result[0], ['result']));
    return result[0].result;
  };
  const ctx = await one('SELECT crest_commands.unapplication_source_snapshot_context($1::uuid) AS result', [businessId]);
  requireSource(exact(ctx, ['schemaVersion', 'scope', 'businessId', 'snapshotToken', 'historySnapshotToken', 'counts'])
    && ctx.schemaVersion === 1 && ctx.scope === 'allocation_unapplication_sources' && ctx.businessId === businessId
    && token(ctx.snapshotToken) && token(ctx.historySnapshotToken) && exact(ctx.counts, groups));
  const { snapshotToken, historySnapshotToken } = ctx;
  const rows = {} as Rows;
  const counts = {} as Record<Group, string>;
  let total = 0;
  for (const group of groups) {
    const expected = ctx.counts[group];
    requireSource(count(expected));
    counts[group] = expected;
    total += Number(expected);
    requireSource(total <= 10_000);
    let after: string | null = null;
    const records: Row[] = [];
    for (;;) {
      const page = await one('SELECT crest_commands.unapplication_source_snapshot_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer) AS result',
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
  const historyContext = await one('SELECT crest_commands.business_history_export_context($1::uuid) AS result', [businessId]);
  requireSource(exact(historyContext, ['schemaVersion', 'scope', 'businessId', 'snapshotToken', 'observedAt', 'recordCounts'])
    && historyContext.schemaVersion === 1 && historyContext.scope === 'business_history' && historyContext.businessId === businessId
    && historyContext.snapshotToken === historySnapshotToken && exact(historyContext.recordCounts, ['operation', 'audit_event']));
  const history = { operation: [] as HistoryRow[], audit_event: [] as HistoryRow[] };
  for (const kind of ['operation', 'audit_event'] as const) {
    const expected = historyContext.recordCounts[kind];
    requireSource(count(expected));
    let after: string | null = null;
    for (;;) {
      const page = await run('SELECT * FROM crest_commands.business_history_export_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer)',
        [businessId, historySnapshotToken, kind, after, 20]);
      if (!page.length) break;
      requireSource(page.length <= 20);
      for (const value of page) {
        requireSource(exact(value, ['record_id', 'representation', 'canonical_evidence', 'evidence_hash'])
          && customerUuid(value.record_id) && (after === null || value.record_id > after)
          && value.representation === 'snapshot_projection' && typeof value.canonical_evidence === 'string'
          && value.evidence_hash === digest(value.canonical_evidence));
        const parsed: unknown = JSON.parse(value.canonical_evidence);
        requireSource(exact(parsed, ['schemaVersion', 'kind', 'businessId', 'jsonTextColumns', 'row']) && parsed.schemaVersion === 1
          && parsed.kind === kind && parsed.businessId === businessId && parsed.row && typeof parsed.row === 'object'
          && 'business_id' in parsed.row && parsed.row.business_id === businessId && 'id' in parsed.row && parsed.row.id === value.record_id);
        history[kind].push(value as HistoryRow);
        after = value.record_id;
      }
      requireSource(history[kind].length <= Number(expected));
    }
    requireSource(history[kind].length === Number(expected));
  }
  return { businessId, snapshotToken, historySnapshotToken, counts, rows, history };
}

function index(rows: readonly Row[], field = 'id') {
  const map = new Map(rows.map(row => [row[field], row]));
  requireSource(map.size === rows.length);
  return map;
}

function find(index: ReadonlyMap<string | null | undefined, Row>, key: string | null | undefined) {
  const found = index.get(key);
  requireSource(found);
  return found;
}

function groupBy(rows: readonly Row[], key: string) {
  const groups = new Map<string | null | undefined, Row[]>();
  for (const row of rows) {
    const bucket = groups.get(row[key]) ?? [];
    bucket.push(row);
    groups.set(row[key], bucket);
  }
  return groups;
}

export function verifyUnapplicationSourceClosure(rows: Rows, history: { operation: HistoryRow[]; audit_event: HistoryRow[] },
  pairedOperationIds:ReadonlySet<unknown>=new Set()) {
  const unapplications = index(rows.allocation_unapplications);
  const groups = index(rows.atomic_finance_groups);
  const journals = index(rows.journal_entries, 'event_id');
  const lots = index(rows.customer_fund_lots, 'unapplication_id');
  const lines = groupBy(rows.journal_lines, 'entry_id');
  const operations = new Map(history.operation.map(source => {
    const { row } = JSON.parse(source.canonical_evidence);
    return [row.operation_id, row] as const;
  }));
  const audits = new Map<string, Record<string, string>[]>();
  for (const source of history.audit_event) {
    const { row } = JSON.parse(source.canonical_evidence);
    const list = audits.get(row.operation_id) ?? [];
    list.push(row);
    audits.set(row.operation_id, list);
  }
  const count = unapplications.size;
  requireSource(rows.financial_events.length === count && groups.size === count && journals.size === count
    && lots.size === count && rows.journal_lines.length === 2 * count);
  const seenUnapplications = new Set<string | null | undefined>(), seenGroups = new Set<string | null | undefined>();
  for (const ordered of groupBy(rows.allocation_unapplications, 'allocation_id').values()) {
    ordered.sort((a, b) => amount(a, 'first_cent') < amount(b, 'first_cent') ? -1 : 1);
    let previous = 0n;
    for (const row of ordered) {
      requireSource(amount(row, 'first_cent') > previous && amount(row, 'last_cent') >= amount(row, 'first_cent'));
      previous = amount(row, 'last_cent');
    }
  }
  for (const event of rows.financial_events) {
    requireSource(event.template === 'P05' && event.template_version === '1' && event.event_sequence === '1'
      && event.invoice_id === null && event.payment_id === null && event.posted_expense_id === null && event.zero_effect_reason === null);
    const unapplication = find(unapplications, event.unapplication_id), group = find(groups, event.group_id);
    requireSource(!seenUnapplications.has(unapplication.id) && !seenGroups.has(group.id));
    seenUnapplications.add(unapplication.id);
    seenGroups.add(group.id);
    requireSource(group.operation_id === unapplication.operation_id && group.created_by === unapplication.created_by);
    const lot = find(lots, unapplication.id), entry = find(journals, event.id);
    const cents = amount(unapplication, 'last_cent') - amount(unapplication, 'first_cent') + 1n;
    requireSource(cents > 0n && amount(lot, 'original_cents') === cents && entry.entry_sequence === '1');
    const journalLines = lines.get(entry.id) ?? [];
    requireSource(journalLines.length === 2 && journalLines.every(line => line.unapplication_id === unapplication.id
      && line.invoice_item_id === null && line.tax_payable_movement_id === null && line.allocation_event_id === null
      && line.money_movement_id === null));
    const ar = journalLines.find(line => line.purpose === 'unapply_ar');
    const funds = journalLines.find(line => line.purpose === 'unapply_funds');
    requireSource(ar && ar.fixed_mapping_id === null && ar.fund_lot_id === null && ar.receivable_id
      && amount(ar, 'debit_cents') === cents && amount(ar, 'credit_cents') === 0n);
    requireSource(funds && funds.fixed_mapping_id === lot.mapping_id && funds.account_id === lot.account_id
      && funds.fund_lot_id === lot.id && funds.receivable_id === null
      && amount(funds, 'debit_cents') === 0n && amount(funds, 'credit_cents') === cents);
    requireSource(unapplication.operation_id);
    const operation = operations.get(unapplication.operation_id);
    const audit = (audits.get(unapplication.operation_id) ?? []).filter(item =>
      item.entity_kind === 'allocation_unapplications' && item.entity_id === unapplication.id && item.action === 'unapply');
    const originalReceipt = {
      schemaVersion: 1, businessId: unapplication.business_id, unapplicationId: unapplication.id, operationId: unapplication.operation_id,
      allocationId: unapplication.allocation_id, eventId: event.id, fundLotId: lot.id, fundingOriginId: lot.origin_id,
      parentPartitionId: lot.parent_partition_id, customerId: lot.customer_id, receivableId: ar.receivable_id, arAccountId: ar.account_id,
      fundsAccountId: lot.account_id, mappingId: lot.mapping_id, effectiveOn: event.effective_on, firstCent: unapplication.first_cent,
      lastCent: unapplication.last_cent, cents: cents.toString(), reason: unapplication.reason,
    };
    const paired=pairedOperationIds.has(unapplication.operation_id);
    requireSource(operation?.command_type === (paired?'finance.invoice.credit_paired':'finance.allocation.unapply') && operation.state === 'committed'
      && operation.actor_id === unapplication.created_by && operation.recovery_epoch === group.recovery_epoch && typeof operation.result === 'string'
      && audit.length === 1 && audit[0]!.actor_id === unapplication.created_by && audit[0]!.reason === unapplication.reason);
    const result=JSON.parse(operation.result);
    requireSource(isDeepStrictEqual(paired?result.release:result, originalReceipt)
      && isDeepStrictEqual(JSON.parse(audit[0]!.delta!), { schemaVersion: 1, before: null, after: originalReceipt }));
  }
}

export function formatUnapplicationSource(source: Awaited<ReturnType<typeof captureUnapplicationSource>>) {
  const { businessId, snapshotToken, historySnapshotToken, counts, rows, history } = source;
  requireSource(customerUuid(businessId) && token(snapshotToken) && token(historySnapshotToken) && exact(rows, groups) && exact(counts, groups));
  const files: { name: string; content: string }[] = [];
  let bytes = 0, total = 0;
  const add = (name: string, content: string) => {
    bytes += Buffer.byteLength(content);
    requireSource(bytes <= wireLimit);
    files.push({ name, content });
  };
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  for (const group of groups) {
    const fields = schema[group].split(' ');
    const records = rows[group].map(row => validateRow(row, group, businessId)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    total += records.length;
    requireSource(count(counts[group]) && Number(counts[group]) === records.length && total <= 10_000);
    index(records);
    const escapes: { row_id: string; column: string; apostrophe_prefix: true }[] = [];
    const csv = [fields.map(quote).join(',')];
    let csvBytes = Buffer.byteLength(csv[0]!) + 2;
    for (const record of records) {
      const line = fields.map(column => {
        const cell = record[column];
        if (cell === null) return quote('\\N');
        let text = cell!.replaceAll('\\', '\\\\');
        if (text.startsWith("'") || /^[=+\-@]/.test(text.trimStart())) {
          text = "'" + text;
          escapes.push({ row_id: record.id!, column, apostrophe_prefix: true });
        }
        return quote(text);
      }).join(',');
      csvBytes += Buffer.byteLength(line) + 2;
      requireSource(bytes + csvBytes <= wireLimit);
      csv.push(line);
    }
    const content = csv.join('\r\n') + '\r\n';
    const decoded = readSourceExportCsv(content, escapes, { columns: fields, maxRows: 10_000 });
    requireSource(decoded.length === records.length && decoded.every((row, i) => fields.every(field => row[field] === records[i]![field])));
    add(group + '.csv', content);
    add(group + '_escape_map.json', JSON.stringify({ schemaVersion: 1, businessId, snapshotToken, group, escapes }) + '\n');
    add(group + '_dictionary.json', JSON.stringify({ schemaVersion: 1, group, columns: fields, key: 'id', null: '\\N',
      format: 'UTF-8 RFC4180 CRLF', decode: 'Import as text. Apply only mapped apostrophe removals, then unescape paired backslashes. Keep cents and sequences as decimal strings.' }) + '\n');
  }
  for (const kind of ['operation', 'audit_event'] as const) {
    for (const record of history[kind]) requireSource(digest(record.canonical_evidence) === record.evidence_hash);
    add(kind + '_history.ndjson', history[kind].map(record => JSON.stringify(record)).join('\n') + (history[kind].length ? '\n' : ''));
  }
  verifyUnapplicationSourceClosure(rows, history);
  const manifest = JSON.stringify({ schemaVersion: 1, scope: 'allocation_unapplication_sources', businessId, snapshotToken, historySnapshotToken,
    recordCounts: counts, exactUnapplicationEffectsVerified: true, referenceClosureComplete: false, completePortableExport: false, completeBackup: false,
    parts: files.map(({ name, content }) => ({ name, bytes: Buffer.byteLength(content), sha256: digest(content) })) }) + '\n';
  return { files, manifest };
}
