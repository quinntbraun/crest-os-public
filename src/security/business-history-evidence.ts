import {createHash} from 'node:crypto';
import {parseEvidenceJson} from './provider-evidence-json.ts';
import {parseHistoryJson, historyJsonEqual, historyJsonNumber} from './history-evidence-json.ts';

type Body = Record<string, unknown>;
type Kind = 'operation' | 'audit_event';
type RecordEvidence = Readonly<{kind: Kind; recordId: string; representation: 'snapshot_projection'; canonicalEvidence: string; evidenceHash: string}>;
const kinds = ['operation', 'audit_event'] as const;
const operationFields = ['id','business_id','operation_id','actor_id','command_type','schema_version','recovery_epoch','payload_hash','state','result_schema_version','result','committed_at','created_at','created_by','origin','import_row_id'];
const auditFields = ['id','business_id','operation_id','actor_id','entity_kind','entity_id','entity_version','action','reason','effective_at','delta','created_at','recorded_at','created_by','origin','import_row_id','database_principal','payload','hash_input','event_hash'];
const payloadFields = ['schemaVersion','hashFormat','id','businessId','operationId','actorId','createdBy','entityKind','entityId','entityVersion','action','reason','delta','origin','importRowId','databasePrincipal','recordedAt','effectiveAt'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
export class BusinessHistoryEvidenceError extends Error {
  constructor() { super('BUSINESS_HISTORY_EVIDENCE_REVIEW_REQUIRED'); this.name = 'BusinessHistoryEvidenceError'; }
}
function require(value: unknown): asserts value { if (!value) throw new BusinessHistoryEvidenceError(); }
function object(value: unknown): asserts value is Body {
  require(value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype));
}
function fields(value: unknown, names: readonly string[]): asserts value is Body {
  object(value); require(Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)));
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !value.includes('\0')
    && Buffer.byteLength(value, 'utf8') <= max && Buffer.from(value, 'utf8').toString('utf8') === value;
}
function id(value: unknown): value is string { return typeof value === 'string' && uuid.test(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 2147483647; }
function digest(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
// PostgreSQL UTC projection spellings and original microseconds are retained.
// Never use Date's millisecond truncation for evidence equality.
function instant(value: unknown, original = false): bigint {
  require(typeof value === 'string');
  const m = (original ? /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.(\d{6})Z$/
    : /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?\+00:00$/).exec(value);
  require(m); const date = new Date(m[1] + 'Z');
  require(Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.toISOString().slice(0,19) === m[1]);
  return BigInt(date.getTime()) * 1000n + BigInt((m[2] ?? '').padEnd(6, '0'));
}
function sourceJson(value: unknown, max: number): unknown { require(text(value, max)); return parseHistoryJson(value); }
function common(row: Body, recordId: string, businessId: string, actors: Set<string>) {
  require(row.id === recordId && row.business_id === businessId && id(row.operation_id) && id(row.actor_id)
    && row.created_by === row.actor_id && typeof row.origin === 'string' && ['manual','import','system'].includes(row.origin)
    && (row.import_row_id === null || id(row.import_row_id)));
  instant(row.created_at); actors.add(row.actor_id);
}
function operation(row: Body) {
  require(id(row.recovery_epoch) && typeof row.payload_hash === 'string' && hash.test(row.payload_hash)
    && typeof row.command_type === 'string' && row.command_type.length <= 100
    && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/.test(row.command_type)
    && integer(row.schema_version) && integer(row.result_schema_version) && row.state === 'committed'
    && instant(row.committed_at) >= instant(row.created_at));
  const result = sourceJson(row.result, 65536); object(result);
  require(historyJsonNumber(result.schemaVersion, row.result_schema_version));
}
function audit(row: Body) {
  require(typeof row.entity_kind === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(row.entity_kind)
    && id(row.entity_id) && typeof row.entity_version === 'string' && /^[1-9][0-9]{0,18}$/.test(row.entity_version)
    && BigInt(row.entity_version) <= 9223372036854775807n
    && typeof row.action === 'string' && /^[a-z][a-z0-9_.]{0,63}$/.test(row.action)
    && (row.reason === null || text(row.reason, 8000) && [...row.reason.replace(/^ +| +$/g,'')].length >= 1 && [...row.reason.replace(/^ +| +$/g,'')].length <= 2000)
    && text(row.database_principal, 63) && row.database_principal.length > 0
    && instant(row.created_at) === instant(row.recorded_at));
  if (row.effective_at !== null) instant(row.effective_at);
  const delta = sourceJson(row.delta, 262144); fields(delta, ['schemaVersion','before','after']);
  require(historyJsonNumber(delta.schemaVersion, 1) && (delta.before !== null || delta.after !== null));
  for (const v of [delta.before, delta.after]) if (v !== null) object(v);
  require(text(row.hash_input, 524288) && row.payload === row.hash_input && typeof row.event_hash === 'string'
    && hash.test(row.event_hash) && digest(row.hash_input) === row.event_hash);
  const payload = sourceJson(row.payload, 524288); fields(payload, payloadFields);
  require(historyJsonNumber(payload.schemaVersion, 1) && payload.hashFormat === 'pg17-jsonb-text-utf8-v1');
  for (const [p, r] of [['id','id'],['businessId','business_id'],['operationId','operation_id'],['actorId','actor_id'],['createdBy','created_by'],
    ['entityKind','entity_kind'],['entityId','entity_id'],['entityVersion','entity_version'],['action','action'],['reason','reason'],
    ['origin','origin'],['importRowId','import_row_id'],['databasePrincipal','database_principal']] as const) require(payload[p] === row[r]);
  require(historyJsonEqual(payload.delta, delta) && instant(payload.recordedAt, true) === instant(row.recorded_at));
  require(row.effective_at === null ? payload.effectiveAt === null : instant(payload.effectiveAt, true) === instant(row.effective_at));
}

// Pure offline validation of an explicitly supplied bounded collection. The
// claimed context/counts and unkeyed hashes cannot prove source completeness,
// authentic snapshot capture, ownership, authorization or recovery readiness.
export function verifyBusinessHistoryEvidence(serialized: unknown, expected: {businessId: string}) {
  try {
    require(text(serialized, 64 * 1024 * 1024)); const businessId = expected.businessId.toLowerCase(); require(id(businessId));
    const c = parseEvidenceJson(serialized); fields(c, ['formatVersion','assurance','generationId','context','evidenceBytes','records']);
    require(c.formatVersion === 1 && c.assurance === 'snapshot_bytes_only' && id(c.generationId)
      && Array.isArray(c.records) && c.records.length <= 1000 && typeof c.evidenceBytes === 'number'
      && Number.isSafeInteger(c.evidenceBytes) && c.evidenceBytes >= 0 && c.evidenceBytes <= 8 * 1024 * 1024);
    const ctx = c.context; fields(ctx, ['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts']);
    require(ctx.schemaVersion === 1 && ctx.scope === 'business_history' && ctx.businessId === businessId
      && typeof ctx.snapshotToken === 'string' && hash.test(ctx.snapshotToken)); instant(ctx.observedAt);
    fields(ctx.recordCounts, kinds);
    const counts = {} as Record<Kind,string>;
    for (const kind of kinds) { const n = ctx.recordCounts[kind]; require(typeof n === 'string' && /^(0|[1-9][0-9]{0,3})$/.test(n) && BigInt(n) <= 1000n); counts[kind] = n; }
    const rows: RecordEvidence[] = [], operations = new Map<string,Body>(), audits: Body[] = [], actors = new Set<string>();
    let bytes = 0, lastKind = -1, lastId = '';
    for (const r of c.records) {
      fields(r, ['kind','recordId','representation','canonicalEvidence','evidenceHash']);
      require((r.kind === 'operation' || r.kind === 'audit_event') && id(r.recordId) && r.representation === 'snapshot_projection');
      const index = kinds.indexOf(r.kind); require(index >= lastKind && (index !== lastKind || r.recordId > lastId)); lastKind = index; lastId = r.recordId;
      require(text(r.canonicalEvidence, r.kind === 'operation' ? 262144 : 2097152) && typeof r.evidenceHash === 'string'
        && hash.test(r.evidenceHash) && digest(r.canonicalEvidence) === r.evidenceHash);
      bytes += Buffer.byteLength(r.canonicalEvidence, 'utf8'); require(bytes <= 8 * 1024 * 1024);
      const b = parseEvidenceJson(r.canonicalEvidence); fields(b, ['schemaVersion','kind','businessId','jsonTextColumns','row']);
      require(b.schemaVersion === 1 && b.kind === r.kind && b.businessId === businessId
        && JSON.stringify(b.jsonTextColumns) === JSON.stringify(r.kind === 'operation' ? ['result'] : ['delta','payload']));
      const row = b.row; fields(row, r.kind === 'operation' ? operationFields : auditFields); common(row, r.recordId, businessId, actors);
      if (r.kind === 'operation') { operation(row); require(!operations.has(row.operation_id as string)); operations.set(row.operation_id as string, row); }
      else { audit(row); audits.push(row); }
      rows.push(Object.freeze({kind:r.kind, recordId:r.recordId, representation:'snapshot_projection', canonicalEvidence:r.canonicalEvidence, evidenceHash:r.evidenceHash}));
    }
    require(bytes === c.evidenceBytes && String(operations.size) === counts.operation && String(audits.length) === counts.audit_event);
    const linked = new Set<string>();
    for (const a of audits) {
      const o = operations.get(a.operation_id as string); require(o && o.actor_id === a.actor_id && o.origin === a.origin && o.import_row_id === a.import_row_id);
      linked.add(a.operation_id as string);
    }
    require(linked.size === operations.size);
    return Object.freeze({formatVersion:1 as const, assurance:'internal_consistency_only' as const, generationId:c.generationId,
      context:Object.freeze({schemaVersion:1 as const, scope:'business_history' as const, businessId, snapshotToken:ctx.snapshotToken,
        observedAt:ctx.observedAt as string, recordCounts:Object.freeze(counts)}), evidenceBytes:bytes, records:Object.freeze(rows),
      requiredActorIds:Object.freeze([...actors].sort()), referenceClosureComplete:false as const,
      completePortableExport:false as const, completeBackup:false as const});
  } catch { throw new BusinessHistoryEvidenceError(); }
}
