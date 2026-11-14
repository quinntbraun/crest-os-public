import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { customerDate, customerInstant, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { readSourceExportCsv } from '../security/source-export-csv-reader.ts';

const schema = {
  external_money_evidence: 'id business_id provider_namespace external_account_id id_namespace external_id raw_reference normalization_rule confirmed_on signed_cents currency',
  payments: 'id business_id customer_id channel_version_id account_id actual_on gross_cents confirmation distinct_reason operation_id created_by created_at',
  money_movements: 'id business_id event_id account_id evidence_id signed_cents',
  funding_origins: 'id business_id payment_id customer_id cents currency',
  funding_partitions: 'id business_id origin_id position first_cent last_cent',
  allocation_events: 'id business_id event_id partition_id receivable_id cents',
  atomic_finance_groups: 'id business_id commit_sequence recovery_epoch created_by operation_id created_at',
  financial_events: 'id business_id group_id event_sequence invoice_id period_id period_generation reopened_generation effective_on time_zone template template_version zero_effect_reason posted_at payment_id',
  journal_entries: 'id business_id event_id entry_sequence',
  journal_lines: 'id business_id entry_id invoice_item_id receivable_id account_id fixed_mapping_id tax_payable_movement_id purpose debit_cents credit_cents money_movement_id allocation_event_id',
} as const;
type Group = keyof typeof schema;
type Row = Record<string, string | null>;
type Rows = Record<Group, Row[]>;
export const receiptFundFields=['id','business_id','unapplication_id','origin_id','parent_partition_id','customer_id','account_id',
  'mapping_id','original_cents','receipt_event_id','journal_line_id'] as const;
type HistoryRow = { record_id: string; representation: 'snapshot_projection'; canonical_evidence: string; evidence_hash: string };
const groups = Object.freeze(Object.keys(schema) as Group[]);
const shared = new Set<Group>(['atomic_finance_groups', 'financial_events', 'journal_entries', 'journal_lines']);
export const receiptSourceCoverage = Object.freeze(groups.filter(group => !shared.has(group)).map(group => Object.freeze({
  table: 'crest.' + group, scope: 'business' as const, required: Object.freeze(schema[group].split(' ')),
  excluded: Object.freeze([]), partialEvidenceGroup: null,
})));
export const receiptSourceAddedColumns = Object.freeze({
  'crest.financial_events': Object.freeze(['payment_id']),
  'crest.journal_lines': Object.freeze(['money_movement_id', 'allocation_event_id']),
});
const nullable: Partial<Record<Group, readonly string[]>> = {
  payments: ['distinct_reason'], money_movements: ['evidence_id'],
  financial_events: ['invoice_id', 'reopened_generation', 'zero_effect_reason'],
  journal_lines: ['invoice_item_id', 'receivable_id', 'fixed_mapping_id', 'tax_payable_movement_id', 'money_movement_id', 'allocation_event_id'],
};
const exactDates = new Set(['actual_on', 'confirmed_on', 'effective_on']);
const exactInts = new Set(['first_cent', 'last_cent', 'position', 'commit_sequence', 'event_sequence',
  'period_generation', 'reopened_generation', 'template_version', 'entry_sequence', 'cents']);
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const token = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,4})$/.test(value) && Number(value) <= 10_000;
const amount = (value: Row, key: string) => BigInt(value[key]!);
const wireLimit = 16 * 1024 * 1024;

function requireSource(condition: unknown): asserts condition {
  if (!condition) throw Error('RECEIPT_SOURCE_REVIEW_REQUIRED');
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
export async function captureReceiptSource(businessId: string, query: Query) {
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
  const ctx = await one('SELECT crest_commands.receipt_source_snapshot_context($1::uuid) AS result', [businessId]);
  requireSource(exact(ctx, ['schemaVersion', 'scope', 'businessId', 'snapshotToken', 'historySnapshotToken', 'counts'])
    && ctx.schemaVersion === 1 && ctx.scope === 'direct_receipt_sources' && ctx.businessId === businessId
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
      const page = await one('SELECT crest_commands.receipt_source_snapshot_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer) AS result',
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

function verifyClosure(rows: Rows, history: { operation: HistoryRow[]; audit_event: HistoryRow[] },funds:readonly Row[] = [],
  tips?:Readonly<{anchors:readonly Readonly<Row>[];lines:readonly Readonly<{id:string;eventId:string;tipRealizationId:string}>[]}>) {
  const payments = index(rows.payments);
  const groups = index(rows.atomic_finance_groups);
  const journal = index(rows.journal_entries, 'event_id');
  const movements = index(rows.money_movements, 'event_id');
  const origins = index(rows.funding_origins, 'payment_id');
  const evidence = index(rows.external_money_evidence);
  const partitions = groupBy(rows.funding_partitions, 'origin_id');
  const applications = index(rows.allocation_events, 'partition_id');
  const heldByEvent = index(funds, 'receipt_event_id');
  const tipAnchors = new Map(tips?.anchors.map(row => [row.receipt_tip_event_id, row]) ?? []);
  const tipLineIds = new Set(tips?.lines.map(row => row.id) ?? []);
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
  const { length: paymentCount } = rows.payments;
  requireSource(rows.financial_events.length === paymentCount && groups.size === paymentCount && journal.size === paymentCount
    && movements.size === paymentCount && origins.size === paymentCount
    && rows.funding_partitions.length === applications.size + funds.length + tipAnchors.size
    && rows.journal_lines.length === paymentCount + applications.size + funds.length + tipLineIds.size);
  const seenPayments = new Set<string | null | undefined>(), seenGroups = new Set<string | null | undefined>();
  const seenEvidence = new Set<string | null | undefined>(), seenPartitions = new Set<string | null | undefined>();
  for (const event of rows.financial_events) {
    requireSource(event.template === 'P03' && event.template_version === '1' && event.event_sequence === '1'
      && event.invoice_id === null && event.zero_effect_reason === null);
    const payment = find(payments, event.payment_id), group = find(groups, event.group_id);
    requireSource(!seenPayments.has(payment.id) && !seenGroups.has(group.id));
    seenPayments.add(payment.id);
    seenGroups.add(group.id);
    requireSource(event.effective_on === payment.actual_on && group.operation_id === payment.operation_id && group.created_by === payment.created_by);
    const movement = find(movements, event.id), root = find(origins, payment.id), entry = find(journal, event.id);
    const gross = amount(payment, 'gross_cents');
    requireSource(gross > 0n && entry.entry_sequence === '1' && movement.account_id === payment.account_id
      && amount(movement, 'signed_cents') === gross && root.customer_id === payment.customer_id
      && amount(root, 'cents') === gross && root.currency === 'USD');
    if (movement.evidence_id !== null) {
      const original = find(evidence, movement.evidence_id);
      requireSource(!seenEvidence.has(original.id) && original.external_account_id === payment.account_id
        && original.confirmed_on === payment.actual_on && original.currency === 'USD' && amount(original, 'signed_cents') === gross);
      seenEvidence.add(original.id);
    }
    const split = (partitions.get(root.id) ?? []).sort((a, b) => Number(a.position) - Number(b.position));
    const tipAnchor = tipAnchors.get(event.id);
    const journalLines = (lines.get(entry.id) ?? []).filter(line => !tipLineIds.has(line.id!));
    const money = journalLines.filter(line => line.purpose === 'receipt_money');
    const allocations = index(journalLines.filter(line => line.purpose === 'receipt_ar'), 'allocation_event_id');
    const held=heldByEvent.get(event.id),heldLine=journalLines.find(line=>line.id===held?.journal_line_id);
    requireSource(journalLines.filter(line=>line.purpose==='receipt_funds').length===(held?1:0));
    if(held)requireSource(heldLine?.purpose==='receipt_funds'&&held.business_id===payment.business_id
      &&held.origin_id===root.id&&held.customer_id===payment.customer_id&&held.unapplication_id===null
      &&heldLine.account_id===held.account_id&&heldLine.fixed_mapping_id===held.mapping_id&&heldLine.receivable_id===null
      &&heldLine.money_movement_id===null&&heldLine.allocation_event_id===null&&amount(heldLine,'debit_cents')===0n
      &&amount(heldLine,'credit_cents')===amount(held,'original_cents'));
    requireSource(split.length > 0 && money.length === 1 && journalLines.length === split.length + 1 - Number(Boolean(tipAnchor))
      && allocations.size + Number(Boolean(held)) + Number(Boolean(tipAnchor)) === split.length
      && money[0]!.money_movement_id === movement.id && money[0]!.account_id === payment.account_id
      && money[0]!.receivable_id === null && money[0]!.allocation_event_id === null && amount(money[0]!, 'debit_cents') === gross
      && amount(money[0]!, 'credit_cents') === 0n && journalLines.every(line =>
        line.invoice_item_id === null && (line===heldLine||line.fixed_mapping_id === null) && line.tax_payable_movement_id === null));
    let used = 0n;
    const originalApplications = [];
    for (const [i, part] of split.entries()) {
      if(held&&held.parent_partition_id===part.id){
        const cents=amount(held,'original_cents');
        requireSource(cents>0n&&i===split.length-1&&!applications.has(part.id)&&part.position===String(i+1)
          &&amount(part,'first_cent')===used+1n&&amount(part,'last_cent')===used+cents);
        seenPartitions.add(part.id);
        used+=cents;
        continue;
      }
      if(tipAnchor&&tipAnchor.parent_partition_id===part.id){
        const cents=amount(tipAnchor,'original_cents');
        requireSource(cents>0n&&i===split.length-1-Number(Boolean(held))&&!applications.has(part.id)
          &&part.position===String(i+1)&&amount(part,'first_cent')===used+1n&&amount(part,'last_cent')===used+cents);
        seenPartitions.add(part.id);
        used+=cents;
        continue;
      }
      const application = find(applications, part.id), line = find(allocations, application.id);
      const cents = amount(application, 'cents');
      requireSource(part.position === String(i + 1) && cents > 0n && amount(part, 'first_cent') === used + 1n
        && amount(part, 'last_cent') === used + cents && application.event_id === event.id
        && line.receivable_id === application.receivable_id && amount(line, 'debit_cents') === 0n
        && amount(line, 'credit_cents') === cents && line.money_movement_id === null);
      seenPartitions.add(part.id);
      used += cents;
      originalApplications.push({ id: application.id, receivableId: application.receivable_id, fundingPartitionId: part.id, cents: cents.toString() });
    }
    requireSource(used === gross && payment.operation_id);
    const operation = operations.get(payment.operation_id);
    const audit = (audits.get(payment.operation_id) ?? []).filter(item =>
      item.entity_kind === 'payments' && item.entity_id === payment.id && item.action === 'record');
    const originalReceipt = {
      schemaVersion: held?2:1, businessId: payment.business_id, paymentId: payment.id, eventId: event.id, customerId: payment.customer_id,
      channelVersionId: payment.channel_version_id, accountId: payment.account_id, actualOn: payment.actual_on, grossCents: payment.gross_cents,
      fundingOriginId: root.id, moneyMovementId: movement.id, externalEvidenceId: movement.evidence_id, applications: originalApplications,
      ...(held?{heldFunds:{lotId:held.id,fundingPartitionId:held.parent_partition_id,mappingId:held.mapping_id,cents:held.original_cents}}:{}),
    };
    requireSource(operation?.command_type === 'finance.receipt.record' && operation.state === 'committed'
      && operation.actor_id === payment.created_by && operation.recovery_epoch === group.recovery_epoch && typeof operation.result === 'string'
      && audit.length === 1 && audit[0]!.actor_id === payment.created_by && audit[0]!.reason === payment.confirmation);
    const original = JSON.parse(operation.result);
    const delta = JSON.parse(audit[0]!.delta!);
    if(tipAnchor){
      requireSource(original?.schemaVersion===3&&isDeepStrictEqual(delta,{schemaVersion:1,before:null,after:original}));
      const {tip:_tip,heldFunds:originalHeld,...base}=original;
      const {heldFunds:expectedHeld,...expected}=originalReceipt;
      requireSource(isDeepStrictEqual({...base,schemaVersion:expected.schemaVersion},expected)
        &&isDeepStrictEqual(originalHeld,expectedHeld??null));
    }else requireSource(isDeepStrictEqual(original, originalReceipt)
      && isDeepStrictEqual(delta, { schemaVersion: 1, before: null, after: originalReceipt }));
  }
  requireSource(seenEvidence.size === evidence.size && seenPartitions.size === rows.funding_partitions.length);
}

export async function captureReceiptFunds(businessId:string,snapshotToken:string,query:Query){
  const result=await query('SELECT crest_commands.receipt_funds_source_snapshot($1::uuid,$2::text) AS result',[businessId,snapshotToken]);
  requireSource(result.length===1&&exact(result[0],['result'])&&Array.isArray(result[0].result)&&result[0].result.length<=1000);
  return result[0].result.map((row:unknown)=>{
    requireSource(exact(row,receiptFundFields)&&row.business_id===businessId&&row.unapplication_id===null
      &&typeof row.original_cents==='string'&&/^[1-9][0-9]{0,18}$/.test(row.original_cents)
      &&receiptFundFields.every(key=>key==='unapplication_id'||key==='original_cents'||customerUuid(row[key])));
    return row as Row;
  });
}

export function formatReceiptSource(source: Awaited<ReturnType<typeof captureReceiptSource>>,funds:readonly Row[] = [],
  tips?:Parameters<typeof verifyClosure>[3]) {
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
  verifyClosure(rows, history,funds,tips);
  const manifest = JSON.stringify({ schemaVersion: 1, scope: 'direct_receipt_sources', businessId, snapshotToken, historySnapshotToken,
    recordCounts: counts, exactReceiptEffectsVerified: true, referenceClosureComplete: false, completePortableExport: false, completeBackup: false,
    parts: files.map(({ name, content }) => ({ name, bytes: Buffer.byteLength(content), sha256: digest(content) })) }) + '\n';
  return { files, manifest };
}
