import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { customerDate, customerInstant, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { readSourceExportCsv } from '../security/source-export-csv-reader.ts';

const schema = {
  posted_expenses: 'id business_id expense_id expense_revision incurred_on paid_on gross_cents purchase_tax_cents purchase_tax_treatment mapping_id expense_account_id channel_version_id money_account_id evidence_id receipt_id receipt_revision missing_receipt_reason unknown_vendor_reason review_reason operation_id created_by created_at',
  external_money_evidence: 'id business_id provider_namespace external_account_id id_namespace external_id raw_reference normalization_rule confirmed_on signed_cents currency',
  money_movements: 'id business_id event_id account_id evidence_id signed_cents',
  atomic_finance_groups: 'id business_id commit_sequence recovery_epoch created_by operation_id created_at',
  financial_events: 'id business_id group_id event_sequence invoice_id period_id period_generation reopened_generation effective_on time_zone template template_version zero_effect_reason posted_at payment_id posted_expense_id',
  journal_entries: 'id business_id event_id entry_sequence',
  journal_lines: 'id business_id entry_id invoice_item_id receivable_id account_id fixed_mapping_id tax_payable_movement_id purpose debit_cents credit_cents money_movement_id allocation_event_id',
} as const;
type Group = keyof typeof schema;
type Row = Record<string, string | null>;
type Rows = Record<Group, Row[]>;
type HistoryRow = { record_id: string; representation: 'snapshot_projection'; canonical_evidence: string; evidence_hash: string };
const groups = Object.freeze(Object.keys(schema) as Group[]);
export const postedExpenseSourceCoverage = Object.freeze({
  table: 'crest.posted_expenses', scope: 'business' as const, required: Object.freeze(schema.posted_expenses.split(' ')),
  excluded: Object.freeze([]), partialEvidenceGroup: null,
});
export const postedExpenseSourceAddedColumns = Object.freeze({ 'crest.financial_events': Object.freeze(['posted_expense_id']) });
const nullable: Partial<Record<Group, readonly string[]>> = {
  posted_expenses: ['receipt_id', 'receipt_revision', 'missing_receipt_reason', 'unknown_vendor_reason'],
  financial_events: ['invoice_id', 'payment_id', 'reopened_generation', 'zero_effect_reason'],
  journal_lines: ['invoice_item_id', 'receivable_id', 'fixed_mapping_id', 'tax_payable_movement_id', 'money_movement_id', 'allocation_event_id'],
};
const exactDates = new Set(['incurred_on', 'paid_on', 'confirmed_on', 'effective_on']);
const exactInts = new Set(['expense_revision', 'receipt_revision', 'commit_sequence', 'event_sequence',
  'period_generation', 'reopened_generation', 'template_version', 'entry_sequence', 'cents']);
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const token = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,4})$/.test(value) && Number(value) <= 10_000;
const amount = (value: Row, key: string) => BigInt(value[key]!);
const wireLimit = 16 * 1024 * 1024;

function requireSource(condition: unknown): asserts condition {
  if (!condition) throw Error('POSTED_EXPENSE_SOURCE_REVIEW_REQUIRED');
}

function validateRow(value: unknown, group: Group, businessId: string): Row {
  const fields = schema[group].split(' ');
  requireSource(exact(value, fields) && value.business_id === businessId);
  for (const field of fields) {
    const cell = value[field];
    if (cell === null && nullable[group]?.includes(field)) continue;
    requireSource(typeof cell === 'string' && !cell.includes('\0') && Buffer.from(cell).toString('utf8') === cell);
    if ((field === 'id' || field.endsWith('_id') && field !== 'external_id') || field === 'created_by' || field === 'recovery_epoch') {
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
export async function capturePostedExpenseSource(businessId: string, query: Query) {
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
  const ctx = await one('SELECT crest_commands.posted_expense_source_snapshot_context($1::uuid) AS result', [businessId]);
  requireSource(exact(ctx, ['schemaVersion', 'scope', 'businessId', 'snapshotToken', 'historySnapshotToken', 'counts'])
    && ctx.schemaVersion === 1 && ctx.scope === 'same_day_expense_sources' && ctx.businessId === businessId
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
      const page = await one('SELECT crest_commands.posted_expense_source_snapshot_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer) AS result',
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

function verifyClosure(rows: Rows, history: { operation: HistoryRow[]; audit_event: HistoryRow[] }) {
  const expenses = index(rows.posted_expenses);
  const groups = index(rows.atomic_finance_groups);
  const journal = index(rows.journal_entries, 'event_id');
  const movements = index(rows.money_movements, 'event_id');
  const evidence = index(rows.external_money_evidence);
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
  const total = expenses.size;
  requireSource(rows.financial_events.length === total && groups.size === total && journal.size === total
    && movements.size === total && evidence.size === total && rows.journal_lines.length === 2 * total);
  const usedExpenses = new Set<string | null | undefined>(), usedGroups = new Set<string | null | undefined>();
  const usedEvidence = new Set<string | null | undefined>();
  for (const event of rows.financial_events) {
    requireSource(event.template === 'P12' && event.template_version === '1' && event.event_sequence === '1'
      && event.invoice_id === null && event.payment_id === null && event.zero_effect_reason === null);
    const expense = find(expenses, event.posted_expense_id), group = find(groups, event.group_id);
    requireSource(!usedExpenses.has(expense.id) && !usedGroups.has(group.id));
    usedExpenses.add(expense.id);
    usedGroups.add(group.id);
    requireSource(event.effective_on === expense.incurred_on && expense.incurred_on === expense.paid_on
      && group.operation_id === expense.operation_id && group.created_by === expense.created_by);
    const movement = find(movements, event.id), entry = find(journal, event.id), originalEvidence = find(evidence, expense.evidence_id);
    const gross = amount(expense, 'gross_cents'), tax = amount(expense, 'purchase_tax_cents');
    requireSource(gross > 0n && tax <= gross && (expense.purchase_tax_treatment === 'none' && tax === 0n
      || expense.purchase_tax_treatment === 'verified_nonrecoverable' && tax > 0n));
    requireSource(expense.receipt_id === null && expense.receipt_revision === null && expense.missing_receipt_reason
      || expense.receipt_id && expense.receipt_revision === '2' && expense.missing_receipt_reason === null);
    requireSource(entry.entry_sequence === '1' && movement.account_id === expense.money_account_id
      && amount(movement, 'signed_cents') === -gross && movement.evidence_id === originalEvidence.id);
    requireSource(!usedEvidence.has(originalEvidence.id) && originalEvidence.external_account_id === expense.money_account_id
      && originalEvidence.confirmed_on === expense.paid_on && originalEvidence.currency === 'USD'
      && amount(originalEvidence, 'signed_cents') === -gross);
    usedEvidence.add(originalEvidence.id);
    const journalLines = lines.get(entry.id) ?? [];
    requireSource(journalLines.length === 2 && journalLines.every(line =>
      line.invoice_item_id === null && line.receivable_id === null && line.tax_payable_movement_id === null && line.allocation_event_id === null));
    const cost = journalLines.find(line => line.purpose === 'expense_cost');
    const money = journalLines.find(line => line.purpose === 'expense_money');
    requireSource(cost && cost.fixed_mapping_id === expense.mapping_id && cost.account_id === expense.expense_account_id
      && cost.money_movement_id === null && amount(cost, 'debit_cents') === gross && amount(cost, 'credit_cents') === 0n);
    requireSource(money && money.fixed_mapping_id === null && money.account_id === expense.money_account_id
      && money.money_movement_id === movement.id && amount(money, 'credit_cents') === gross && amount(money, 'debit_cents') === 0n);
    requireSource(expense.operation_id);
    const operation = operations.get(expense.operation_id);
    const audit = (audits.get(expense.operation_id) ?? []).filter(item =>
      item.entity_kind === 'posted_expenses' && item.entity_id === expense.id && item.action === 'post');
    const originalReceipt = {
      schemaVersion: 1, businessId: expense.business_id, postedExpenseId: expense.id, expenseId: expense.expense_id,
      expenseRevision: expense.expense_revision, eventId: event.id, incurredOn: expense.incurred_on, paidOn: expense.paid_on,
      grossCents: expense.gross_cents, purchaseTaxCents: expense.purchase_tax_cents, purchaseTaxTreatment: expense.purchase_tax_treatment,
      mappingId: expense.mapping_id, expenseAccountId: expense.expense_account_id, channelVersionId: expense.channel_version_id,
      moneyAccountId: expense.money_account_id, externalEvidenceId: expense.evidence_id, moneyMovementId: movement.id,
      receiptId: expense.receipt_id, receiptRevision: expense.receipt_revision, missingReceiptReason: expense.missing_receipt_reason,
      unknownVendorReason: expense.unknown_vendor_reason,
    };
    requireSource(operation?.command_type === 'finance.expense.post_same_day' && operation.state === 'committed'
      && operation.actor_id === expense.created_by && operation.recovery_epoch === group.recovery_epoch && typeof operation.result === 'string'
      && audit.length === 1 && audit[0]!.actor_id === expense.created_by && audit[0]!.reason === expense.review_reason);
    requireSource(isDeepStrictEqual(JSON.parse(operation.result), originalReceipt)
      && isDeepStrictEqual(JSON.parse(audit[0]!.delta!), { schemaVersion: 1, before: null, after: originalReceipt }));
  }
  requireSource(usedEvidence.size === evidence.size);
}

export function formatPostedExpenseSource(source: Awaited<ReturnType<typeof capturePostedExpenseSource>>) {
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
  verifyClosure(rows, history);
  const manifest = JSON.stringify({ schemaVersion: 1, scope: 'same_day_expense_sources', businessId, snapshotToken, historySnapshotToken,
    recordCounts: counts, exactExpenseEffectsVerified: true, referenceClosureComplete: false, completePortableExport: false, completeBackup: false,
    parts: files.map(({ name, content }) => ({ name, bytes: Buffer.byteLength(content), sha256: digest(content) })) }) + '\n';
  return { files, manifest };
}
