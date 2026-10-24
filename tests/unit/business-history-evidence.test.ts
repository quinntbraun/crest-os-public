import {describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {verifyBusinessHistoryEvidence as verify} from '../../src/security/business-history-evidence.ts';
import {historyFixture,historyDigest as digest} from '../support/business-history-fixture.ts';

const error = 'BUSINESS_HISTORY_EVIDENCE_REVIEW_REQUIRED';
type Fixture = ReturnType<typeof historyFixture>;
const check = (f:Fixture) => verify(f.encode(),{businessId:f.businessId});
const reject = (f:Fixture) => expect(()=>check(f)).toThrow(error);
function change(f:Fixture,index:number,work:(body:ReturnType<typeof JSON.parse>)=>void) {
  const r=f.collection.records[index]!,b=JSON.parse(r.canonicalEvidence);work(b);
  r.canonicalEvidence=JSON.stringify(b);r.evidenceHash=digest(r.canonicalEvidence);
}
describe('offline business history evidence',()=>{
 it('retains exact source bytes and returns an immutable explicitly incomplete actor-reference inventory',()=>{
  const f=historyFixture(),r=check(f);expect(r.records).toEqual(f.collection.records);expect(r.requiredActorIds).toEqual([f.actorId]);
  expect(r.assurance).toBe('internal_consistency_only');expect(r.referenceClosureComplete).toBe(false);expect(r.completePortableExport).toBe(false);expect(r.completeBackup).toBe(false);
  for(const value of [r,r.context,r.context.recordCounts,r.records,...r.records,r.requiredActorIds])expect(Object.isFrozen(value)).toBe(true);
 });
 it('accepts explicitly empty history without claiming original source completeness',()=>{const f=historyFixture();f.collection.records=[];f.collection.context.recordCounts={operation:'0',audit_event:'0'};expect(check(f).requiredActorIds).toEqual([]);});
 it('rejects missing audits and receipts even when claimed counts and byte totals are corrected',()=>{
  for(const index of [0,1]){const f=historyFixture();f.collection.records.splice(index,1);f.collection.context.recordCounts[index===0?'operation':'audit_event']='0';reject(f);}
 });
 it('preserves unsafe integers and high-precision decimals without Number rounding',()=>{
  const f=historyFixture();expect(check(f).records[0]!.canonicalEvidence).toContain('9007199254740993');
  change(f,1,b=>{b.row.delta=b.row.delta.replace('9007199254740993','9007199254740992');});reject(f);
  const g=historyFixture();change(g,1,b=>{b.row.delta=b.row.delta.replace('0.12345678901234567890123456789','0.12345678901234567890123456788');});reject(g);
 });
 it('accepts exact equivalent numeric spellings in JSONB comparisons and keeps originals',()=>{
  const f=historyFixture();change(f,1,b=>{b.row.delta=b.row.delta.replace('9007199254740993','9007199254740993.00').replace('0.12345678901234567890123456789','1.2345678901234567890123456789e-1');});expect(check(f).records).toEqual(f.collection.records);
 });
 it('compares recorded and effective timestamps at microsecond precision',()=>{
  const f=historyFixture();f.audit.effective_at=f.audit.recorded_at;f.bindAudit();f.refresh();check(f);
  for(const key of ['recorded_at','effective_at']){const g=historyFixture();g.audit.effective_at=g.audit.recorded_at;g.bindAudit();g.refresh();change(g,1,b=>{b.row[key]=b.row[key].replace('123456','123457');if(key==='recorded_at')b.row.created_at=b.row[key];});reject(g);}
 });
 it('retains nulls and does not infer current authorization from historical epochs',()=>{
  const f=historyFixture();f.audit.effective_at=null;f.operation.recovery_epoch=randomUUID();f.refresh();expect(check(f).records).toEqual(f.collection.records);
 });
 it.each(['schemaVersion','kind','businessId','jsonTextColumns','row','extra'])('rejects a malformed rehashed projection %s',key=>{const f=historyFixture();change(f,1,b=>{b[key]=key==='schemaVersion'?2:'invalid';});reject(f);});
 it.each(['id','business_id','operation_id','actor_id','command_type','schema_version','recovery_epoch','payload_hash','state','result_schema_version','result','committed_at','created_at','created_by','origin','import_row_id','extra'])('rejects a malformed rehashed operation %s',key=>{
  const f=historyFixture();change(f,0,b=>{b.row[key]='invalid';});reject(f);
 });
 it.each(['id','business_id','operation_id','actor_id','entity_kind','entity_id','entity_version','action','reason','effective_at','delta','created_at','recorded_at','created_by','origin','import_row_id','database_principal','payload','hash_input','event_hash','extra'])('rejects a malformed rehashed audit %s',key=>{
  const f=historyFixture();change(f,1,b=>{b.row[key]='invalid';});reject(f);
 });
 it.each(['id','businessId','operationId','actorId','createdBy','entityKind','entityId','entityVersion','action','reason','origin','importRowId','databasePrincipal','recordedAt','effectiveAt','hashFormat','schemaVersion','extra'])('rejects valid original hashes with contradictory payload binding %s',key=>{
  const f=historyFixture();change(f,1,b=>{const p=JSON.parse(b.row.payload);p[key]=key==='schemaVersion'?2:'invalid';b.row.payload=JSON.stringify(p);b.row.hash_input=b.row.payload;b.row.event_hash=digest(b.row.payload);});reject(f);
 });
 it.each(['0','-1','01','1.0','9223372036854775808','9007199254740993.0'])('rejects invalid audit version strings %s',value=>{const f=historyFixture();f.audit.entity_version=value;f.bindAudit();f.refresh();reject(f);});
 it.each([0,-1,2147483648,1.5,null])('rejects invalid command schema versions %s',value=>{const f=historyFixture();change(f,0,b=>{b.row.schema_version=value;});reject(f);});
 it.each(['{}','null','[]','1','{"schemaVersion":2}','{"schemaVersion":1,"schema\\u0056ersion":1}'])('rejects invalid result JSON %s',value=>{const f=historyFixture();f.operation.result=value;f.refresh();reject(f);});
 it.each(['null','[]','1','{"schemaVersion":1,"before":null,"after":null}','{"schemaVersion":1,"before":1,"after":{}}','{"schemaVersion":1,"before":[],"after":{}}','{"schemaVersion":1,"before":null,"after":{},"extra":1}'])('rejects invalid source delta %s',value=>{
  const f=historyFixture();change(f,1,b=>{b.row.delta=value;});reject(f);
 });
 it('rejects duplicate decoded keys at every transport and source layer',()=>{
  const f=historyFixture();const s=f.encode().replace('"formatVersion":1','"formatVersion":1,"format\\u0056ersion":1');expect(()=>verify(s,{businessId:f.businessId})).toThrow(error);
  for(const key of ['result','delta','payload']){const g=historyFixture();change(g,key==='result'?0:1,b=>{b.row[key]=b.row[key].replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1');if(key==='payload'){b.row.hash_input=b.row.payload;b.row.event_hash=digest(b.row.payload);}});reject(g);}
  const g=historyFixture(),r=g.collection.records[0]!;r.canonicalEvidence=r.canonicalEvidence.replace('"kind":"operation"','"kind":"operation","kind":"operation"');r.evidenceHash=digest(r.canonicalEvidence);reject(g);
 });
 it('rejects contradictory receipt audit links with valid scope UUIDs and hashes',()=>{
  for(const key of ['operation_id','actor_id','origin','import_row_id'] as const){const f=historyFixture();change(f,0,b=>{b.row[key]=key==='origin'?'system':randomUUID();if(key==='actor_id')b.row.created_by=b.row[key];});reject(f);}
 });
 it('supports multiple audits for a receipt and reports required actor IDs in deterministic order',()=>{
  const f=historyFixture();f.audit.id=randomUUID();f.bindAudit();const a=f.record('audit_event',f.audit);f.collection.records.push(a);
  const other=historyFixture();other.operation.business_id=f.businessId;other.audit.business_id=f.businessId;other.bindAudit();
  f.collection.records.push(f.record('operation',other.operation),f.record('audit_event',other.audit));
  f.collection.records.sort((x,y)=>x.kind===y.kind?x.recordId.localeCompare(y.recordId):x.kind==='operation'?-1:1);f.collection.context.recordCounts={operation:'2',audit_event:'3'};
  const report=check(f);expect(report.records).toHaveLength(5);expect(report.requiredActorIds).toEqual([f.actorId,other.actorId].sort());
 });
 it('rejects duplicate operation request IDs even if row IDs and source counts are distinct',()=>{const f=historyFixture();f.operation.id=randomUUID();f.collection.records.push(f.record('operation',f.operation));f.collection.records.sort((a,b)=>a.kind===b.kind?a.recordId.localeCompare(b.recordId):a.kind==='operation'?-1:1);f.collection.context.recordCounts.operation='2';reject(f);});
 it.each(['formatVersion','assurance','generationId','context','evidenceBytes','records','extra'])('rejects malformed collection %s',key=>{const f=historyFixture(),c=JSON.parse(f.encode());c[key]='invalid';expect(()=>verify(JSON.stringify(c),{businessId:f.businessId})).toThrow(error);});
 it.each(['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts','extra'])('rejects malformed context %s',key=>{const f=historyFixture();Object.assign(f.collection.context,{[key]:'invalid'});reject(f);});
 it.each(['01','-1','1.0','1001','9007199254740993'])('rejects malformed counts %s',value=>{const f=historyFixture();f.collection.context.recordCounts.operation=value;reject(f);});
 it.each(['kind','recordId','representation','canonicalEvidence','evidenceHash','extra'])('rejects malformed envelope %s',key=>{const f=historyFixture();Object.assign(f.collection.records[0]!,{[key]:'invalid'});reject(f);});
 it('rejects duplicate and reordered envelopes, byte mismatch and another caller scope',()=>{
  const f=historyFixture();f.collection.records.reverse();reject(f);const g=historyFixture();g.collection.records.push(g.collection.records[1]!);g.collection.context.recordCounts.audit_event='2';reject(g);
  const h=historyFixture(),c=JSON.parse(h.encode());c.evidenceBytes++;expect(()=>verify(JSON.stringify(c),{businessId:h.businessId})).toThrow(error);expect(()=>verify(h.encode(),{businessId:randomUUID()})).toThrow(error);
 });
 it.each(['2026-02-30T07:00:00+00:00','2026-10-24T25:00:00+00:00','2026-10-24T07:00:00.1234567+00:00','infinity','0000-10-24T07:00:00+00:00','2026-10-24T07:00:00-05:00'])('rejects invalid projection timestamps %s',value=>{const f=historyFixture();f.operation.created_at=value;f.refresh();reject(f);});
 it('rejects a receipt committed before creation',()=>{const f=historyFixture();f.operation.committed_at='2026-10-24T07:00:00.123455+00:00';f.refresh();reject(f);});
 it('handles zero fractions, exponent equivalence and object key order without replacing source text',()=>{
  const f=historyFixture();f.audit.delta='{"after":{"x":-0.00,"array":[1e2,true,false,null,"a"]},"before":{},"schemaVersion":1}';f.bindAudit();f.refresh();change(f,1,b=>{b.row.delta='{"schemaVersion":1.0,"before":{},"after":{"array":[100,true,false,null,"a"],"x":0}}';});check(f);
 });
 it.each(['{"schemaVersion":1,"x":01}','{"schemaVersion":1,"x":1.}','{"schemaVersion":1,"x":NaN}','{"schemaVersion":1,"x":1e9999999}','{"schemaVersion":1,}','{"schemaVersion":1,"x":"\\u0000"}','{"schemaVersion":1,"x":"\\ud800"}'])('rejects malformed bounded nested JSON %s',value=>{const f=historyFixture();f.operation.result=value;f.refresh();reject(f);});
 it('accepts a deep but bounded receipt and rejects excessive nesting and array width',()=>{
  const f=historyFixture();f.operation.result='{"schemaVersion":1,"nested":'+ '['.repeat(15)+'true'+']'.repeat(15)+'}';f.refresh();check(f);
  for(const result of ['{"schemaVersion":1,"nested":'+'['.repeat(33)+'0'+']'.repeat(33)+'}','{"schemaVersion":1,"items":['+'0,'.repeat(10000)+'0]}']){f.operation.result=result;f.refresh();reject(f);}
 });
 it('rejects source and collection byte overflows with one redacted error and no partial output',()=>{
  const f=historyFixture();f.operation.result=JSON.stringify({schemaVersion:1,text:'x'.repeat(65536)});f.refresh();reject(f);
  for(const s of ['\ufeff'+f.encode(),f.encode()+'\0','"\\ud800"','x'.repeat(64*1024*1024+1)]){try{verify(s,{businessId:f.businessId});throw new Error('expected rejection');}catch(e){expect((e as Error).message).toBe(error);expect((e as Error).cause).toBeUndefined();}}
 });
 it('rejects an aggregate over8MiB of individually valid audit bodies without returning partial history',()=>{
  const f=historyFixture();f.audit.delta=JSON.stringify({schemaVersion:1,before:null,after:{text:'x'.repeat(180000)}});f.bindAudit();f.refresh();
  for(let i=0;i<19;i++){f.audit.id=randomUUID();f.bindAudit();f.collection.records.push(f.record('audit_event',f.audit));}
  f.collection.records.sort((a,b)=>a.kind===b.kind?a.recordId.localeCompare(b.recordId):a.kind==='operation'?-1:1);f.collection.context.recordCounts.audit_event='20';
  const encoded=f.encode();expect(f.collection.evidenceBytes).toBeGreaterThan(8*1024*1024);expect(Buffer.byteLength(encoded)).toBeLessThan(64*1024*1024);reject(f);
  const lied=JSON.parse(encoded);lied.evidenceBytes=0;expect(()=>verify(JSON.stringify(lied),{businessId:f.businessId})).toThrow(error);
 });
 it('rejects more than1000 records before parsing record bodies',()=>{const f=historyFixture();f.collection.records=Array.from({length:1001},()=>f.collection.records[0]!);reject(f);});
 it('rejects a source object beyond the10000-key processing bound',()=>{
  const f=historyFixture();f.audit.delta=JSON.stringify({schemaVersion:1,before:null,after:Object.fromEntries(Array.from({length:10001},(_,i)=>['k'+i,0]))});f.bindAudit();f.refresh();reject(f);
 });
 it('never treats comma-containing object names as the required schema fields',()=>{
  const f=historyFixture();change(f,1,b=>{const value=b.row.reason;delete b.row.reason;delete b.row.origin;b.row['origin,reason']=value;});reject(f);
 });
 it('rejects fractional metadata lexemes that JavaScript would round to an allowed integer',()=>{
  for(const key of ['schemaVersion','schema_version','result_schema_version']){
   const f=historyFixture(),r=f.collection.records[0]!;r.canonicalEvidence=r.canonicalEvidence.replace('"'+key+'":1','"'+key+'":1.0000000000000001');r.evidenceHash=digest(r.canonicalEvidence);reject(f);
  }
  const f=historyFixture();for(const key of ['formatVersion','schemaVersion'])expect(()=>verify(f.encode().replace('"'+key+'":1','"'+key+'":1.0000000000000001'),{businessId:f.businessId})).toThrow(error);
  const input=f.encode().replace(/"evidenceBytes":([0-9]+)/,'"evidenceBytes":$1.0000000000000001');expect(()=>verify(input,{businessId:f.businessId})).toThrow(error);
 });
});
