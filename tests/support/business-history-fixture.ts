import {createHash, randomUUID} from 'node:crypto';
export const historyDigest = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export function historyFixture() {
  const businessId = randomUUID(), actorId = randomUUID(), operationId = randomUUID();
  const time = '2026-10-24T07:00:00.123456+00:00', originalTime = '2026-10-24T07:00:00.123456Z';
  const operation = {id:randomUUID(),business_id:businessId,operation_id:operationId,actor_id:actorId,command_type:'synthetic.history',
    schema_version:1,recovery_epoch:randomUUID(),payload_hash:historyDigest('synthetic request'),state:'committed',result_schema_version:1,
    result:'{"schemaVersion":1,"large":9007199254740993,"fraction":0.12345678901234567890123456789}',committed_at:time,created_at:time,created_by:actorId,origin:'manual',import_row_id:null};
  const delta = '{"schemaVersion":1,"before":null,"after":{"counter":9007199254740993,"fraction":0.12345678901234567890123456789,"label":' + JSON.stringify('雪, "\\') + '}}';
  // Build arbitrary source text, then insert exact numeric lexemes. This is a
  // synthetic consistency fixture; PostgreSQL output is exercised separately.
  const audit = {id:randomUUID(),business_id:businessId,operation_id:operationId,actor_id:actorId,entity_kind:'businesses',entity_id:businessId,
    entity_version:'9007199254740993',action:'synthetic.history',reason:'Synthetic evidence',effective_at:null as string|null,delta,
    created_at:time,recorded_at:time,created_by:actorId,origin:'manual',import_row_id:null,database_principal:'synthetic',payload:'',hash_input:'',event_hash:''};
  function bindAudit() {
    const d = JSON.parse(audit.delta);
    const p = {schemaVersion:1,hashFormat:'pg17-jsonb-text-utf8-v1',id:audit.id,businessId:audit.business_id,operationId:audit.operation_id,
      actorId:audit.actor_id,createdBy:audit.created_by,entityKind:audit.entity_kind,entityId:audit.entity_id,entityVersion:audit.entity_version,
      action:audit.action,reason:audit.reason,delta:d,origin:audit.origin,importRowId:audit.import_row_id,databasePrincipal:audit.database_principal,
      recordedAt:originalTime,effectiveAt:audit.effective_at === null ? null : originalTime};
    // Replace the entire delta token rather than parse/reserialize its numbers.
    const encoded = JSON.stringify(p), start = encoded.indexOf('"delta":') + 8;
    const end = encoded.indexOf(',"origin":', start);
    audit.payload = encoded.slice(0,start) + audit.delta + encoded.slice(end);
    audit.hash_input = audit.payload; audit.event_hash = historyDigest(audit.hash_input);
  }
  bindAudit();
  const record = (kind:'operation'|'audit_event',row:typeof operation|typeof audit) => {
    const canonicalEvidence = JSON.stringify({schemaVersion:1,kind,businessId,jsonTextColumns:kind==='operation'?['result']:['delta','payload'],row});
    return {kind,recordId:row.id,representation:'snapshot_projection',canonicalEvidence,evidenceHash:historyDigest(canonicalEvidence)};
  };
  const collection = {formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:{schemaVersion:1,scope:'business_history',
    businessId,snapshotToken:historyDigest('claimed snapshot'),observedAt:time,recordCounts:{operation:'1',audit_event:'1'}},evidenceBytes:0,
    records:[record('operation',operation),record('audit_event',audit)]};
  function encode() { collection.evidenceBytes = collection.records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0); return JSON.stringify(collection); }
  function refresh() { collection.records = [record('operation',operation),record('audit_event',audit)]; return encode(); }
  return {businessId,actorId,operation,audit,bindAudit,collection,record,encode,refresh};
}
