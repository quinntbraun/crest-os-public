import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { strToU8, zipSync } from 'fflate';
import { customerInstant as instant, customerUuid as uuid, customerVersion as version,
  exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { readSourceExportCsv } from '../security/source-export-csv-reader.ts';
import { calendarEventEtag } from './google-calendar-reconciliation.ts';

const columns = {
  destinations: ['id','business_id','provider_calendar_id','created_by','operation_id','created_at'],
  consents: ['id','business_id','destination_id','generation','previous_generation','recovery_epoch','state',
    'client_name','service_label','work_address','created_by','operation_id','created_at'],
  mappings: ['id','business_id','destination_id','job_id','event_uuid','correlation_marker','created_by','operation_id','created_at'],
  outbox: ['id','business_id','destination_id','connection_generation','recovery_epoch','job_id','appointment_id',
    'appointment_sequence','mapping_id','action','created_by','operation_id','created_at'],
  dispatch_leases: ['id','business_id','outbox_id','attempt_no','mode','leased_at','lease_until'],
  dispatch_sends: ['id','business_id','lease_id','action','request_sha256','prior_etag','recorded_at'],
  request_admissions: ['id','business_id','lease_id','setup_attempt_id','creation_attempt_id','kind','admitted_at'],
  dispatch_results: ['id','business_id','lease_id','outcome','provider_etag','source_current','recorded_at','retry_at'],
  disconnects: ['id','business_id','destination_id','recovery_epoch','disconnected_generation','prior_generation',
    'fenced_at','drain_until','actor_id','operation_id'],
  revocation_admissions: ['id','business_id','disconnect_id','attempt_id','phase','recorded_at','deadline','actor_id'],
  revocation_outcomes: ['id','business_id','disconnect_id','attempt_id','phase','recorded_at','actor_id'],
  creation_intents: ['id','business_id','attempt_id','actor_id','recovery_epoch','correlation_marker','confirmed_at'],
  creation_results: ['id','business_id','attempt_id','recorded_at','outcome','provider_calendar_id'],
} as const;

const groupNames = Object.keys(columns) as (keyof typeof columns)[];
type Group = typeof groupNames[number];
type Row = Readonly<Record<string, string | null>> & { readonly id: string };
type Groups = Readonly<Record<Group, readonly Row[]>>;
const maximumRows = 1000;
const maxBytes = 4 * 1024 * 1024;
const timestamp = /(?:_at|_until)$|^deadline$/;
const versionField = /(?:generation|sequence)$|^attempt_no$/;
const formula = /^[\s]*[=+\-@]|^'/;
const booleanFields = ['client_name', 'service_label', 'work_address', 'source_current'];
const nullable = ['previous_generation', 'prior_etag', 'provider_etag', 'retry_at', 'lease_id', 'setup_attempt_id',
  'creation_attempt_id', 'provider_calendar_id'];
const controlled = {
  state: ['active','paused','disconnected'],
  action: ['publish','remove','insert','update','delete'],
  mode: ['dispatch','reconcile'],
  kind: ['read_event','verify_destination','insert','update','delete','verify_setup_destination','create_secondary'],
  outcome: ['published','removed','no_effect','delayed','reconnect','review','uncertain','created'],
  phase: ['admitted','revoked','uncertain'],
} satisfies Record<string, readonly string[]>;
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function requireSource(condition: unknown): asserts condition {
  if (!condition) throw Error('GOOGLE_CALENDAR_SOURCE_REVIEW_REQUIRED');
}

function fieldValid(name: string, value: unknown) {
  if (value === null) return nullable.includes(name);
  if (typeof value !== 'string') return false;
  if (name === 'provider_calendar_id') return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group\.calendar\.google\.com$/.test(value);
  if (name === 'prior_etag' || name === 'provider_etag') return calendarEventEtag(value);
  if (name === 'request_sha256') return hash(value);
  if (timestamp.test(name)) return instant(value);
  if (versionField.test(name)) return version(value);
  if (booleanFields.includes(name)) return value === 'true' || value === 'false';
  if (Object.hasOwn(controlled, name)) return (controlled[name as keyof typeof controlled] as readonly string[]).includes(value);
  return uuid(value);
}

function row(value: unknown, group: Group, businessId: string): Row {
  requireSource(exact(value, columns[group]) && uuid(value.id) && value.business_id === businessId &&
    columns[group].every(field => fieldValid(field, value[field])));
  return value as Row;
}

function verifyLinks(groups: Groups) {
  const lookup = (group: Group) => new Map(groups[group].map(item => [item.id, item]));
  const destinations = lookup('destinations'), mappings = lookup('mappings'), outbox = lookup('outbox');
  const leases = lookup('dispatch_leases'), disconnects = lookup('disconnects'), creation = lookup('creation_intents');
  const consents = new Map(groups.consents.map(item => [item.destination_id + ':' + item.generation, item]));
  const admits = new Set(groups.request_admissions.filter(item => item.kind === 'create_secondary').map(item => item.creation_attempt_id));
  const revoked = new Map(groups.revocation_admissions.map(item => [item.id, item]));
  const shared = (item: Row, linked: Row | undefined, ...fields: string[]) => !!linked && fields.every(field => item[field] === linked[field]);
  requireSource(groups.consents.every(item => destinations.has(item.destination_id!) &&
    (item.previous_generation === null ? item.generation === '1' : consents.has(item.destination_id + ':' + item.previous_generation))));
  requireSource(groups.mappings.every(item => destinations.has(item.destination_id!) && item.event_uuid !== item.correlation_marker));
  requireSource(groups.outbox.every(item => shared(item, mappings.get(item.mapping_id!), 'destination_id', 'job_id') &&
    shared(item, consents.get(item.destination_id + ':' + item.connection_generation), 'recovery_epoch') &&
    (item.action === 'publish' || item.action === 'remove')));
  requireSource(groups.dispatch_leases.every(item => outbox.has(item.outbox_id!) && BigInt(item.attempt_no!) <= 5n));
  requireSource(groups.dispatch_sends.every(item => leases.has(item.lease_id!) && ['insert','update','delete'].includes(item.action!) &&
    (item.action === 'insert') === (item.prior_etag === null)));
  requireSource(groups.request_admissions.every(item => {
    const { lease_id: lease, creation_attempt_id: original, setup_attempt_id: setup, kind } = item;
    return kind === 'create_secondary' ? !!original && creation.has(original) && lease === null && setup === null :
      kind === 'verify_setup_destination' ? !!setup && lease === null && original === null : !!lease && leases.has(lease) && setup === null && original === null;
  }));
  requireSource(groups.dispatch_results.every(item => leases.has(item.lease_id!) && item.outcome !== 'created' &&
    (item.outcome === 'published') === (item.provider_etag !== null) &&
    ['delayed','uncertain'].includes(item.outcome!) === (item.retry_at !== null)));
  requireSource(groups.disconnects.every(item => {
    const next = consents.get(item.destination_id + ':' + item.disconnected_generation);
    return next?.state === 'disconnected' && shared(item, next, 'recovery_epoch') &&
      consents.has(item.destination_id + ':' + item.prior_generation);
  }));
  requireSource(groups.revocation_admissions.every(item => item.phase === 'admitted' && item.id === item.disconnect_id &&
    disconnects.has(item.id)) && groups.revocation_outcomes.every(item => item.phase !== 'admitted' &&
    item.id === item.disconnect_id && shared(item, revoked.get(item.id), 'attempt_id')));
  requireSource(groups.creation_intents.every(item => item.id === item.attempt_id) && groups.creation_results.every(item =>
    item.id === item.attempt_id && creation.has(item.id) && admits.has(item.id) &&
    ['created','review','uncertain'].includes(item.outcome!) && (item.outcome === 'created') === (item.provider_calendar_id !== null)));
}

function source(value: unknown, businessId: string) {
  requireSource(uuid(businessId) && exact(value, ['schemaVersion','businessId','groups','snapshotToken']) && value.schemaVersion === 1 &&
    value.businessId === businessId && hash(value.snapshotToken) && exact(value.groups, groupNames));
  const raw = value.groups;
  const groups = {} as Record<Group, readonly Row[]>;
  let total = 0;
  for (const group of groupNames) {
    const values = raw[group];
    requireSource(Array.isArray(values) && (total += values.length) <= maximumRows);
    const rows = values.map(value => row(value, group, businessId));
    requireSource(rows.every((item, index) => index === 0 || item.id > rows[index - 1]!.id));
    groups[group] = rows;
  }
  verifyLinks(groups);
  return { groups, snapshotToken: value.snapshotToken };
}

const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function formatCsv(group: Group, rows: readonly Row[]) {
  const fields = columns[group];
  const escapes: { row_id: string; column: string; apostrophe_prefix: true }[] = [];
  const lines = [fields.map(quote).join(',')];
  for (const item of rows) {
    lines.push(fields.map(column => {
      const original = item[column];
      if (original === null) return quote('\\N');
      let cell = original!.replaceAll('\\', '\\\\');
      if (formula.test(cell)) {
        cell = "'" + cell;
        escapes.push({ row_id: item.id, column, apostrophe_prefix: true });
      }
      return quote(cell);
    }).join(','));
  }
  const csv = lines.join('\r\n') + '\r\n';
  requireSource(isDeepStrictEqual(readSourceExportCsv(csv, escapes, { columns: fields, maxRows: maximumRows }), rows));
  return { csv, escapes };
}

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relations = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relationNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const declarations = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function workbook(groups: Groups) {
  const worksheet = (group: Group) => {
    const fields = columns[group];
    const values = [fields, ...groups[group].map(item => fields.map(field => item[field] ?? null))];
    const rows = values.map((values, rowIndex) => '<row r="' + (rowIndex + 1) + '">' + values.map((value, columnIndex) =>
      value === null ? '' : '<c r="' + String.fromCharCode(65 + columnIndex) + (rowIndex + 1) +
        '" t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>').join('') + '</row>');
    return declarations + '<worksheet xmlns="' + ns + '"><sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>' +
      rows.join('') + '</sheetData><autoFilter ref="A1:' + String.fromCharCode(64 + fields.length) + values.length + '"/></worksheet>';
  };
  const parts: Record<string, Uint8Array> = {};
  const add = (name: string, content: string) => { parts[name] = strToU8(content); };
  const relation = (id: number, name: string, target: string) => '<Relationship Id="rId' + id + '" Type="' + relations + '/' +
    name + '" Target="' + target + '"/>';
  add('[Content_Types].xml', declarations + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    groupNames.map((_, index) => '<Override PartName="/xl/worksheets/sheet' + (index + 1) +
      '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
  add('_rels/.rels', declarations + '<Relationships xmlns="' + relationNs + '">' + relation(1, 'officeDocument', 'xl/workbook.xml') + '</Relationships>');
  add('xl/workbook.xml', declarations + '<workbook xmlns="' + ns + '" xmlns:r="' + relations +
    '"><bookViews><workbookView/></bookViews><sheets>' + groupNames.map((name, index) =>
      '<sheet name="' + xml(name.replaceAll('_', ' ')) + '" sheetId="' + (index + 1) + '" r:id="rId' + (index + 1) + '"/>').join('') +
    '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', declarations + '<Relationships xmlns="' + relationNs + '">' +
    groupNames.map((_, index) => relation(index + 1, 'worksheet', 'worksheets/sheet' + (index + 1) + '.xml')).join('') + '</Relationships>');
  groupNames.forEach((group, index) => add('xl/worksheets/sheet' + (index + 1) + '.xml', worksheet(group)));
  return zipSync(parts, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') });
}

export async function captureGoogleCalendarPortableSource(businessId: string,
  query: (statement: string, args: unknown[]) => Promise<unknown[]>) {
  requireSource(uuid(businessId));
  const result = await query('SELECT crest_commands.google_calendar_source_snapshot($1::uuid) AS result', [businessId]);
  requireSource(Array.isArray(result) && result.length === 1 && exact(result[0], ['result']) &&
    Buffer.byteLength(JSON.stringify(result)) <= maxBytes);
  const { groups, snapshotToken } = source(result[0].result, businessId);
  const files: Record<string, Uint8Array> = {};
  const escapeMap: Record<string, unknown> = {};
  for (const group of groupNames) {
    const { csv, escapes } = formatCsv(group, groups[group]);
    files[group + '.csv'] = strToU8(csv);
    escapeMap[group] = escapes;
  }
  files['calendar_escape_map.json'] = strToU8(JSON.stringify(escapeMap) + '\n');
  files['calendar_dictionary.json'] = strToU8(JSON.stringify({ schemaVersion: 1, columns,
    csv: 'UTF-8 RFC4180 CRLF. All non-null columns are exact text; \\N denotes null. Remove only marked leading apostrophes, then unescape paired backslashes.',
    workbook: 'Each sheet mirrors its CSV and stores exact text. Blank cells denote null.',
    scope: 'Destination, consent, mapping, appointment and redacted attempt history. Provider secrets and raw provider payloads are excluded.' }) + '\n');
  files['calendar.xlsx'] = workbook(groups);
  requireSource(Object.values(files).reduce((n, bytes) => n + bytes.byteLength, 0) <= maxBytes);
  const manifest = JSON.stringify({ schemaVersion: 1, scope: 'crest.google-calendar-portable-source.v1', businessId, snapshotToken,
    completePortableExport: false, completeBackup: false, parts: Object.entries(files).map(([name, bytes]) =>
      ({ name, bytes: bytes.byteLength, sha256: digest(bytes) })) }) + '\n';
  return { manifest, files };
}
