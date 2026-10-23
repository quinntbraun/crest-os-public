import {createHash,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {verifyProviderEvidenceCollection as verify} from '../../src/security/provider-evidence-verification.ts';

const kinds=['inventory_observation','login_attempt','login_target','login_finish','cleanup_request','cleanup_outcome'];
type Row={kind:string;recordId:string;canonicalEvidence:string;evidenceHash:string};
const digest=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const error='PROVIDER_EVIDENCE_VERIFICATION_REVIEW_REQUIRED';
function row(kind:string,e:Record<string,unknown>):Row{
  const canonicalEvidence=JSON.stringify(e,null,1);return {kind,recordId:String(e[kind==='login_attempt'||kind==='login_target'?'attemptId':kind==='login_finish'?'finishId':'requestId']),canonicalEvidence,evidenceHash:digest(canonicalEvidence)};
}
function change(r:Row,changes:Record<string,unknown>){r.canonicalEvidence=JSON.stringify({...JSON.parse(r.canonicalEvidence),...changes});r.evidenceHash=digest(r.canonicalEvidence);}
function fixture(full=true){
  const actorId=randomUUID(),issuer='https://auth.example.com/auth/v1',attemptId=randomUUID(),providerSessionId=randomUUID(),registrationEventId=randomUUID(),stop=randomUUID(),requestId=randomUUID();
  const common={schemaVersion:1,origin:'system',actorId,providerIssuer:issuer,securityEpoch:randomUUID(),providerSubject:randomUUID(),appSessionId:randomUUID(),createdAt:'2026-10-23T12:00:00.123456+00:00',databasePrincipal:'synthetic_probe'};
  const start=row('login_attempt',{...common,attemptId}),target=row('login_target',{...common,attemptId,providerSessionId,passwordAt:'2026-10-23T11:00:00.123456+00:00',accessExpiresAt:'2026-10-23T11:00:00.123457+00:00'});
  const closed=row('login_finish',{...common,attemptId,finishId:randomUUID(),phase:'registration_closed',providerSessionId,registrationEventId,localRevokedAt:null});
  const stopped=row('login_finish',{...common,attemptId,finishId:stop,phase:'stopped_review',providerSessionId,registrationEventId,localRevokedAt:common.createdAt});
  const request=row('cleanup_request',{...common,attemptId,requestId,sourceFinishId:stop,sourceFinishHash:stopped.evidenceHash,targetHash:target.evidenceHash,providerSessionId,registrationEventId,cleanupReferenceId:randomUUID(),localRevokedAt:common.createdAt,state:'pending_review'});
  const outcome=row('cleanup_outcome',{...common,requestId,requestHash:request.evidenceHash,providerSessionId,sourceFinishId:stop,outcome:'provider_absent_observed'});
  const inventory=row('inventory_observation',{schemaVersion:1,origin:'system',actorId,providerIssuer:issuer,requestId:randomUUID(),afterSessionId:null,pageSize:100,observedAt:common.createdAt,recordedAt:common.createdAt,databasePrincipal:'synthetic_probe',observationCount:0,lastSessionId:null,observations:[]});
  const records=full?[inventory,start,target,closed,stopped,request,outcome]:[inventory];records.sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind)||a.recordId.localeCompare(b.recordId));
  const collection={formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:{schemaVersion:1,scope:'retained_provider_ledgers',actorId,providerIssuer:issuer,snapshotToken:'a'.repeat(64),observedAt:common.createdAt,ledgerCounts:{} as Record<string,string>},evidenceBytes:0,records};
  return {expected:{actorId,issuer},collection,inventory,start,target,closed,stopped,request,outcome};
}
type Fixture=ReturnType<typeof fixture>;
function encode(f:Fixture){const c=f.collection;c.evidenceBytes=c.records.reduce((n,r)=>n+Buffer.byteLength(r.canonicalEvidence),0);c.context.ledgerCounts=Object.fromEntries(kinds.map(k=>[k,String(c.records.filter(r=>r.kind===k).length)]));return JSON.stringify(c);}
function reject(f:Fixture){expect(()=>verify(encode(f),f.expected)).toThrow(error);}
function sample(f:Fixture,changes:Record<string,unknown>={}){
  return {provider_session_id:randomUUID(),app_session_id:null,cleanup_reference_id:null,provider_aal:'aal1',provider_not_after:null,provider_unexpired:true,local_revoked_at:null,local_expires_at:null,local_epoch_current:null,actor_disabled:false,observed_at:f.collection.context.observedAt,classification:'unregistered_review',...changes};
}
function samples(f:Fixture,rows:ReturnType<typeof sample>[]){rows.sort((a,b)=>String(a.provider_session_id).localeCompare(String(b.provider_session_id)));change(f.inventory,{observationCount:rows.length,lastSessionId:rows.at(-1)?.provider_session_id??null,observations:rows});}

it('verifies all six ledgers and links while preserving immutable original evidence bytes',()=>{
  const f=fixture(),r=verify(encode(f),f.expected);expect(r.assurance).toBe('internal_consistency_only');expect(r.records).toEqual(f.collection.records);expect(r.attempts).toEqual([{attemptId:f.start.recordId,missingKinds:[]}]);
  for(const x of [r,r.context,r.context.ledgerCounts,r.records,...r.records,r.attempts,...r.attempts,r.attempts[0]!.missingKinds])expect(Object.isFrozen(x)).toBe(true);
  expect(r.records[0]!.canonicalEvidence).not.toBe(JSON.stringify(JSON.parse(r.records[0]!.canonicalEvidence)));f.collection.records[0]!.canonicalEvidence='mutated';expect(r.records[0]!.canonicalEvidence).not.toBe('mutated');
});
it('keeps empty scopes explicit and never claims a complete backup or authenticated snapshot',()=>{
  const f=fixture(false);f.collection.records=[];const r=verify(encode(f),f.expected);expect(r.records).toEqual([]);expect(r.attempts).toEqual([]);expect(r.context.ledgerCounts.login_attempt).toBe('0');expect(r).not.toHaveProperty('ready');expect(r).not.toHaveProperty('providerAbsent');
});
it('reports missing lifecycle facts for a start-only group',()=>{const f=fixture();f.collection.records=[f.start];expect(verify(encode(f),f.expected).attempts[0]!.missingKinds).toEqual(['target','registration_finish','stop','request','outcome']);});
it('accepts late target evidence with the original null stop and a pending request',()=>{
  const f=fixture();change(f.stopped,{providerSessionId:null,registrationEventId:null,localRevokedAt:null});change(f.request,{sourceFinishHash:f.stopped.evidenceHash,registrationEventId:null,cleanupReferenceId:null,localRevokedAt:null});f.collection.records=f.collection.records.filter(r=>r!==f.closed&&r!==f.outcome);expect(verify(encode(f),f.expected).attempts[0]!.missingKinds).toEqual(['registration_finish','outcome']);
});
it('accepts a legacy registration finish without inventing a missing signed target',()=>{
  const f=fixture();f.collection.records=f.collection.records.filter(r=>r===f.start||r===f.closed||r===f.stopped);expect(verify(encode(f),f.expected).attempts[0]!.missingKinds).toEqual(['target','request','outcome']);
});
it.each(['unregistered_review','registered_observed','registered_review','local_revocation_review'])('validates original inventory classification %s',classification=>{
  const f=fixture(false),registered=classification!=='unregistered_review',o=sample(f,{classification,...(registered?{app_session_id:randomUUID(),provider_aal:'aal2',local_expires_at:'2026-10-24T00:00:00+00:00',local_epoch_current:true}:{}),...(classification==='registered_review'?{actor_disabled:true}:{}),...(classification==='local_revocation_review'?{local_revoked_at:f.collection.context.observedAt}:{})});samples(f,[o]);expect(verify(encode(f),f.expected).records).toEqual(f.collection.records);
});
it.each([null,'aal1','aal2','aal3'])('preserves nullable and pinned provider AAL %s',provider_aal=>{const f=fixture(false);samples(f,[sample(f,{provider_aal})]);expect(verify(encode(f),f.expected).records).toHaveLength(1);});
it.each(['infinity','-infinity','2026-10-23T12:00:00.123455+00:00','2026-10-23T12:00:00.123456+00:00','2026-10-23T12:00:00.123457+00:00'])('uses original provider deadlines without losing microseconds: %s',provider_not_after=>{
  const f=fixture(false);samples(f,[sample(f,{provider_not_after,provider_unexpired:provider_not_after.endsWith('123457+00:00')})]);expect(verify(encode(f),f.expected).records).toHaveLength(1);
});
it.each(['app_session_id','cleanup_reference_id','provider_aal','provider_not_after','provider_unexpired','local_revoked_at','local_expires_at','local_epoch_current','actor_disabled','observed_at','classification','extra'])('rejects invalid nested inventory field %s after rehashing',key=>{
  const f=fixture(false);samples(f,[sample(f,{[key]:key==='provider_unexpired'?false:key==='observed_at'?'2026-10-23T12:00:01+00:00':key==='local_expires_at'?'infinity':'invalid'})]);reject(f);
});
it.each(['schemaVersion','origin','actorId','providerIssuer','requestId','afterSessionId','pageSize','observedAt','recordedAt','databasePrincipal','observationCount','lastSessionId','observations','extra'])('rejects invalid inventory header field %s',key=>{
  const f=fixture(false);change(f.inventory,{[key]:key==='pageSize'?101:key==='schemaVersion'?2:key==='recordedAt'?'2026-10-23T12:00:00.123455+00:00':key==='databasePrincipal'?'x'.repeat(64):'invalid'});reject(f);
});
it('rejects observation duplicate/reversed/cursor IDs and incorrect nested counts',()=>{
  for(const mode of ['duplicate','reverse','cursor','count','page-cap']){const f=fixture(false),a=sample(f),b=sample(f);samples(f,[a,b]);const e=JSON.parse(f.inventory.canonicalEvidence);if(mode==='duplicate')e.observations[1].provider_session_id=e.observations[0].provider_session_id;if(mode==='reverse')e.observations.reverse();if(mode==='cursor')e.afterSessionId=e.observations[0].provider_session_id;if(mode==='count')e.observationCount=1;if(mode==='page-cap')e.pageSize=1;change(f.inventory,e);reject(f);}
});
it('accepts a nonnull exclusive inventory cursor and exactly100 original observations',()=>{
  const f=fixture(false);samples(f,Array.from({length:100},()=>sample(f)));change(f.inventory,{afterSessionId:'00000000-0000-0000-0000-000000000000'});expect(verify(encode(f),f.expected).records).toHaveLength(1);
});
it.each(['login_attempt','login_target','login_finish','cleanup_request','cleanup_outcome'])('rejects a source primary ID inconsistent with its %s envelope',kind=>{const f=fixture();f.collection.records.find(r=>r.kind===kind)!.recordId=randomUUID();f.collection.records.sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind)||a.recordId.localeCompare(b.recordId));reject(f);});
it.each(['start','target','stopped','request'] as const)('rejects a missing required included source %s',name=>{const f=fixture();f.collection.records=f.collection.records.filter(r=>r!==f[name]);reject(f);});
it('rejects a second finish for the same attempt/phase even with a different primary key',()=>{const f=fixture();const dup=row('login_finish',{...JSON.parse(f.closed.canonicalEvidence),finishId:randomUUID()});f.collection.records.push(dup);f.collection.records.sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind)||a.recordId.localeCompare(b.recordId));reject(f);});
it.each(['sourceFinishHash','targetHash','sourceFinishId','providerSessionId','securityEpoch'])('rejects a rehashed contradictory request %s',key=>{const f=fixture();change(f.request,{[key]:key.endsWith('Hash')?'0'.repeat(64):randomUUID()});change(f.outcome,{requestHash:f.request.evidenceHash});reject(f);});
it('rejects nonmatching legacy provider IDs when no signed target is available',()=>{const f=fixture();f.collection.records=f.collection.records.filter(r=>r===f.start||r===f.closed||r===f.stopped);change(f.stopped,{providerSessionId:randomUUID()});reject(f);});
it('rejects contradictory local revocation instants retained in linked originals',()=>{const f=fixture();change(f.request,{localRevokedAt:'2026-10-23T12:00:00.123457+00:00'});change(f.outcome,{requestHash:f.request.evidenceHash});reject(f);});
it.each(['schemaVersion','origin','actorId','providerIssuer','securityEpoch','providerSubject','appSessionId','createdAt','databasePrincipal','extra'])('reuses strict lifecycle schemas for invalid start field %s',key=>{const f=fixture();f.collection.records=[f.start];change(f.start,{[key]:key==='schemaVersion'?2:key==='createdAt'?'2026-02-30T00:00:00+00:00':key==='databasePrincipal'?'':'invalid'});reject(f);});
it.each([undefined,null,{},[],true,1,'','\ufeff{}','{} garbage','[[]'.repeat(10000),'{"a":1e999}','{"a":01}','{"a":true,}','{"a":"\\q"}','{"a":"\\uZZZZ"}'])('rejects malformed/unsupported framing %#',value=>{expect(()=>verify(value,fixture().expected)).toThrow(error);});
it.each(['formatVersion','assurance','generationId','context','records','evidenceBytes','extra'])('rejects malformed collection field %s',key=>{const f=fixture(),c=JSON.parse(encode(f));c[key]=key==='evidenceBytes'?-1:key==='formatVersion'?2:'invalid';expect(()=>verify(JSON.stringify(c),f.expected)).toThrow(error);});
it.each(['schemaVersion','scope','actorId','providerIssuer','snapshotToken','observedAt','ledgerCounts','extra'])('rejects malformed context %s',key=>{const f=fixture(),c=JSON.parse(encode(f));c.context[key]=key==='schemaVersion'?2:key==='observedAt'?'2026-02-30T00:00:00+00:00':'invalid';expect(()=>verify(JSON.stringify(c),f.expected)).toThrow(error);});
it.each(['number','negative','leading-zero','oversize','missing','extra','count-mismatch','bytes-mismatch'])('rejects invalid counts/accounting %s',mode=>{const f=fixture(),c=JSON.parse(encode(f));if(mode==='bytes-mismatch')c.evidenceBytes++;else if(mode==='missing')delete c.context.ledgerCounts.login_attempt;else if(mode==='extra')c.context.ledgerCounts.extra='0';else c.context.ledgerCounts.login_attempt=mode==='number'?1:mode==='negative'?'-1':mode==='leading-zero'?'01':mode==='oversize'?'9'.repeat(1000):'2';expect(()=>verify(JSON.stringify(c),f.expected)).toThrow(error);});
it.each(['bytes','hash','upper-hash','extra','kind','duplicate','reversed','array-body'])('rejects bad record envelope or ordering %s',mode=>{
  const f=fixture(),r=f.collection.records[0]!;if(mode==='bytes')r.canonicalEvidence+=' ';if(mode==='hash')r.evidenceHash='0'.repeat(64);if(mode==='upper-hash')r.evidenceHash=r.evidenceHash.toUpperCase();if(mode==='extra')Object.assign(r,{extra:'secret'});if(mode==='kind')r.kind='unknown';if(mode==='duplicate')f.collection.records.splice(1,0,r);if(mode==='reversed')f.collection.records.reverse();if(mode==='array-body'){const c=JSON.parse(encode(f));c.records[0].canonicalEvidence=[];expect(()=>verify(JSON.stringify(c),f.expected)).toThrow(error);}else reject(f);
});
it.each(['root','context','envelope','body','nested-body','escaped-body'])('rejects duplicate decoded JSON names at every level: %s',mode=>{
  const f=fixture(false);let source=encode(f);
  if(mode==='root')source=source.replace('"formatVersion":1','"formatVersion":2,"formatVersion":1');
  if(mode==='context')source=source.replace('"scope":"retained_provider_ledgers"','"scope":"bad","scope":"retained_provider_ledgers"');
  if(mode==='envelope')source=source.replace('"kind":"inventory_observation"','"kind":"bad","kind":"inventory_observation"');
  if(mode.includes('body')){if(mode==='nested-body')samples(f,[sample(f)]);const before=f.inventory.canonicalEvidence;f.inventory.canonicalEvidence=before.replace(mode==='nested-body'?'"actor_disabled":false':'"origin": "system"',mode==='nested-body'?'"actor_disabled":true,"actor_disabled":false':mode==='escaped-body'?String.raw`"origin":"manual","\u006frigin":"system"`:'"origin":"manual","origin":"system"');expect(f.inventory.canonicalEvidence).not.toBe(before);f.inventory.evidenceHash=digest(f.inventory.canonicalEvidence);source=encode(f);}
  expect(()=>verify(source,f.expected)).toThrow(error);
});
it('rejects unpaired surrogates and embedded NUL in decoded original fields',()=>{for(const databasePrincipal of ['\ud800','\0']){const f=fixture(false);change(f.inventory,{databasePrincipal});reject(f);}});
it('handles punctuation and escaped property-looking content inside ordinary strings',()=>{const f=fixture(false);change(f.inventory,{databasePrincipal:'a "key":\\value'});expect(verify(encode(f),f.expected).records).toEqual(f.collection.records);});
it('validates up to1000 complete start groups and rejects an extra row',()=>{
  const f=fixture();f.collection.records=Array.from({length:1000},()=>row('login_attempt',{...JSON.parse(f.start.canonicalEvidence),attemptId:randomUUID(),appSessionId:randomUUID()})).sort((a,b)=>a.recordId.localeCompare(b.recordId));expect(verify(encode(f),f.expected).attempts).toHaveLength(1000);f.collection.records.push(f.collection.records[0]!);reject(f);
});
it('enforces global reserved-app and signed-provider uniqueness across distinct attempts',()=>{
  for(const mode of ['app','provider']){const f=fixture(),e=JSON.parse(f.start.canonicalEvidence),newId=randomUUID(),newStart=row('login_attempt',{...e,attemptId:newId,...(mode==='provider'?{appSessionId:randomUUID()}:{})});f.collection.records=[f.start,newStart];if(mode==='provider')f.collection.records.push(f.target,row('login_target',{...JSON.parse(f.target.canonicalEvidence),attemptId:newId,appSessionId:JSON.parse(newStart.canonicalEvidence).appSessionId}));f.collection.records.sort((a,b)=>kinds.indexOf(a.kind)-kinds.indexOf(b.kind)||a.recordId.localeCompare(b.recordId));reject(f);}
});
it('accepts exactly8MiB original bodies and rejects excess without truncating',()=>{
  const f=fixture(false),body=JSON.parse(f.inventory.canonicalEvidence);f.collection.records=Array.from({length:32},()=>{const r=row('inventory_observation',{...body,requestId:randomUUID()});r.canonicalEvidence+=' '.repeat(262144-Buffer.byteLength(r.canonicalEvidence));r.evidenceHash=digest(r.canonicalEvidence);return r;}).sort((a,b)=>a.recordId.localeCompare(b.recordId));expect(verify(encode(f),f.expected).evidenceBytes).toBe(8*1024*1024);f.collection.records.push(f.start);reject(f);
});
it('preserves assurance limits when an internally consistent fragment omits a whole lifecycle and adjusts unkeyed metadata',()=>{
  const f=fixture();f.collection.records=[f.inventory];f.collection.generationId=randomUUID();f.collection.context.snapshotToken='b'.repeat(64);const r=verify(encode(f),f.expected);expect(r.assurance).toBe('internal_consistency_only');expect(r.attempts).toEqual([]);
});
it('normalizes only expected UUID spelling and rejects a different actor or issuer',()=>{
  const f=fixture();expect(verify(encode(f),{...f.expected,actorId:f.expected.actorId.toUpperCase()}).context.actorId).toBe(f.expected.actorId);for(const expected of [{...f.expected,actorId:randomUUID()},{...f.expected,issuer:'https://other.example.com'}])expect(()=>verify(encode(f),expected)).toThrow(error);
});
it('redacts source/parser diagnostics and error causes',()=>{const e=(()=>{try{verify('{private token secret',fixture().expected);}catch(e){return e;}})() as Error&{cause?:unknown};expect(e.message).toBe(error);expect(e.cause).toBeUndefined();});
it.each([{local_epoch_current:false},{local_expires_at:'2026-10-23T12:00:00.123455+00:00'},{local_expires_at:'2026-10-23T12:00:00.123456+00:00'},{provider_aal:null},{provider_aal:'aal3'},{provider_not_after:'infinity',provider_unexpired:false}])('validates each original registered-review condition %#',changes=>{
  const f=fixture(false);samples(f,[sample(f,{app_session_id:randomUUID(),provider_aal:'aal2',local_expires_at:'2026-10-24T00:00:00+00:00',local_epoch_current:true,classification:'registered_review',...changes})]);expect(verify(encode(f),f.expected).records).toHaveLength(1);
});
it('preserves original classification precedence when several reasons coexist',()=>{
  const f=fixture(false);samples(f,[sample(f,{app_session_id:randomUUID(),cleanup_reference_id:randomUUID(),provider_aal:null,local_expires_at:'2026-10-23T12:00:00.123456+00:00',local_epoch_current:false,actor_disabled:true,local_revoked_at:f.collection.context.observedAt,classification:'local_revocation_review'})]);expect(verify(encode(f),f.expected).records).toHaveLength(1);
});
it('bounds UTF8 bytes separately from UTF16 length for long Unicode source strings',()=>{
  const f=fixture(false),issuer='https://auth.example.com/'+'雪'.repeat(350);f.expected.issuer=issuer;f.collection.context.providerIssuer=issuer;change(f.inventory,{providerIssuer:issuer,databasePrincipal:'雪'.repeat(20)});expect(verify(encode(f),f.expected).records).toEqual(f.collection.records);
});
it('compares linked revocation instants at exact microsecond precision across equivalent spellings',()=>{
  const f=fixture();change(f.stopped,{localRevokedAt:'2026-10-23T12:00:00.1+00:00'});change(f.request,{sourceFinishHash:f.stopped.evidenceHash,localRevokedAt:'2026-10-23T12:00:00.100000+00:00'});change(f.outcome,{requestHash:f.request.evidenceHash});expect(verify(encode(f),f.expected).attempts[0]!.missingKinds).toEqual([]);
});
it('rejects serialized input above64MiB before parsing',()=>{expect(()=>verify('x'.repeat(64*1024*1024+1),fixture().expected)).toThrow(error);});
