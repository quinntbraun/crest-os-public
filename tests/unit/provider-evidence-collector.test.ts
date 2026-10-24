import {createHash} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const db=vi.hoisted(()=>({configs:[] as Record<string,unknown>[],clients:[] as {events:Record<string,()=>void>}[],query:vi.fn(),connect:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({default:{Client:class{
  events:Record<string,()=>void>={};
  constructor(config:Record<string,unknown>){db.configs.push(config);db.clients.push(this);}
  on(name:string,fn:()=>void){this.events[name]=fn;return this;}once(name:string,fn:()=>void){return this.on(name,fn);}
  connect(){return db.connect();}query(...args:unknown[]){return db.query(...args);}end(){return db.end();}
}}}));
import {createProviderEvidenceCollector,createProviderRecoveryEvidenceCollector} from '../../src/security/provider-evidence-collector.ts';
const actorId='11111111-1111-1111-1111-111111111111',issuer='https://auth.example.com/auth/v1';
const config={connectionString:'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000',environment:'test' as const,actorId,issuer};
const kinds=['inventory_observation','login_attempt','login_target','login_finish','cleanup_request','cleanup_outcome'];
const signal=()=>new AbortController().signal;
const error='PROVIDER_EVIDENCE_COLLECTION_REVIEW_REQUIRED';
let ctx:Record<string,unknown>,pages:Record<string,ReturnType<typeof row>[]>;
function row(n=1,canonical_evidence='{"synthetic":"original UTF8 café"}'){
  return {record_id:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,canonical_evidence,evidence_hash:createHash('sha256').update(canonical_evidence).digest('hex')};
}
function counts(){return ctx.ledgerCounts as Record<string,string>;}
function answer(sql:string,args:unknown[]=[]):unknown{
  if(sql.startsWith('SELECT current_user'))return {rows:[{allowed:true}]};
  if(sql.startsWith('BEGIN'))return {command:'BEGIN',rows:[]};
  if(sql==='COMMIT')return {command:'COMMIT',rows:[]};
  if(sql.includes('_context('))return {rows:[{result:ctx}]};
  if(sql.includes('_page('))return {rows:(pages[args[3] as string]??[]).filter(r=>args[4]===null||r.record_id>(args[4] as string)).slice(0,20)};
  throw new Error('unexpected SQL');
}
beforeEach(()=>{
  vi.resetAllMocks();db.configs.length=0;db.clients.length=0;db.connect.mockResolvedValue(undefined);db.end.mockResolvedValue(undefined);db.query.mockImplementation(answer);
  ctx={schemaVersion:1,scope:'retained_provider_ledgers',actorId,providerIssuer:issuer,snapshotToken:'a'.repeat(64),observedAt:'2026-10-23T12:00:00.123456+00:00',ledgerCounts:Object.fromEntries(kinds.map(k=>[k,'0']))};pages={};
});
afterEach(()=>vi.useRealTimers());
it('owns one connection one first-data context six ordered scans and confirms COMMIT before returning frozen originals',async()=>{
  for(const k of kinds){pages[k]=[row()];counts()[k]='1';}
  const r=await createProviderEvidenceCollector(config)(signal());expect(db.configs).toHaveLength(1);expect(r.assurance).toBe('snapshot_bytes_only');expect(r.context).toEqual(ctx);expect(r.records).toHaveLength(6);expect(r.evidenceBytes).toBe(6*Buffer.byteLength(row().canonical_evidence));
  expect(r.records.map(x=>x.kind)).toEqual(kinds);expect(r.records[0]).toEqual({kind:kinds[0],recordId:row().record_id,canonicalEvidence:row().canonical_evidence,evidenceHash:row().evidence_hash});
  for(const v of [r,r.context,r.context.ledgerCounts,r.records,...r.records])expect(Object.isFrozen(v)).toBe(true);
  expect(db.query.mock.calls.map(c=>c[0])).toEqual([expect.stringContaining('SELECT current_user'),'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',expect.stringContaining('_context('),...kinds.map(()=>expect.stringContaining('_page(')),'COMMIT']);
  for(const [index,k] of kinds.entries())expect(db.query.mock.calls[index+3]?.[1]).toEqual([actorId,issuer,'a'.repeat(64),k,null,20]);
  expect(db.configs[0]).toMatchObject({ssl:false,options:'-c role=crest_inventory',statement_timeout:3000,query_timeout:3500,idle_in_transaction_session_timeout:4000});expect(db.end).toHaveBeenCalledOnce();
});
it('keeps explicit zero counts and reads all empty ledgers without claiming complete backup or provider absence',async()=>{
  const r=await createProviderEvidenceCollector(config)(signal());expect(r.records).toEqual([]);expect(r.evidenceBytes).toBe(0);expect(r).not.toHaveProperty('ready');expect(r).not.toHaveProperty('providerAbsent');expect(r.context.scope).toBe('retained_provider_ledgers');
});
it.each([20,23,40,1000])('uses exclusive fixed-size pages with a terminal empty page when needed for %i rows',async n=>{
  pages.login_attempt=Array.from({length:n},(_,i)=>row(i+1));counts().login_attempt=String(n);
  const r=await createProviderEvidenceCollector(config)(signal());expect(r.records.map(x=>x.recordId)).toEqual(pages.login_attempt.map(x=>x.record_id));
  const calls=db.query.mock.calls.filter(c=>c[1]?.[3]==='login_attempt');expect(calls).toHaveLength(Math.floor(n/20)+1);expect(calls[1]?.[1]?.[4]).toBe(row(20).record_id);
});
it('preserves whitespace and multibyte bytes without parsing or reserializing original evidence',async()=>{
  pages.login_attempt=[row(1,' { "retained" : "雪 café" }\n')];counts().login_attempt='1';const r=await createProviderEvidenceCollector(config)(signal());expect(r.records[0]?.canonicalEvidence).toBe(pages.login_attempt[0]?.canonical_evidence);expect(r.evidenceBytes).toBe(Buffer.byteLength(pages.login_attempt[0]!.canonical_evidence));
});
it.each(['schema','scope','actor','issuer','token','array-token','time','invalid-day','year-zero','extra','missing-count','extra-count','numeric-count','negative-count','leading-zero','huge-count','total-cap'])('rejects malformed or over-budget context %s before pages',async change=>{
  if(change==='schema')ctx.schemaVersion=2;if(change==='scope')ctx.scope='all';if(change==='actor')ctx.actorId=row().record_id;if(change==='issuer')ctx.providerIssuer+='other';if(change==='token')ctx.snapshotToken='A'.repeat(64);if(change==='array-token')ctx.snapshotToken=['a'.repeat(64)];
  if(change==='time')ctx.observedAt='yesterday';if(change==='invalid-day')ctx.observedAt='2026-02-30T00:00:00+00:00';if(change==='year-zero')ctx.observedAt='0000-01-01T00:00:00+00:00';if(change==='extra')ctx.secret='synthetic';if(change==='missing-count')delete counts().login_attempt;if(change==='extra-count')counts().other='0';if(change==='numeric-count')(counts() as Record<string,unknown>).login_attempt=1;
  if(change==='negative-count')counts().login_attempt='-1';if(change==='leading-zero')counts().login_attempt='01';if(change==='huge-count')counts().login_attempt='9'.repeat(10000);if(change==='total-cap'){counts().login_attempt='1000';counts().login_finish='1';}
  await expect(createProviderEvidenceCollector(config)(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0].includes('_page('))).toBe(false);expect(db.end).toHaveBeenCalledOnce();
});
it.each(['hash','extra','id','upper-id','array-body','empty-body','nul','surrogate','body-cap','utf8-cap','order','duplicate','short-count','extra-count','page-cap'])('discards every partial record on malformed page %s',async change=>{
  pages.login_attempt=[row(1),row(2)];counts().login_attempt='2';const bad=pages.login_attempt[1]!;
  if(change==='hash')bad.evidence_hash='b'.repeat(64);if(change==='extra')(bad as Record<string,unknown>).secret='synthetic';if(change==='id')bad.record_id='bad';if(change==='upper-id')bad.record_id='AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';if(change==='array-body')(bad as Record<string,unknown>).canonical_evidence=['coerced'];
  if(['empty-body','nul','surrogate','body-cap','utf8-cap'].includes(change)){const b=change==='empty-body'?'':change==='nul'?'\0':change==='surrogate'?'\ud800':change==='utf8-cap'?'雪'.repeat(3000):'x'.repeat(8193);Object.assign(bad,row(2,b));}
  if(change==='order')pages.login_attempt.reverse();if(change==='duplicate')bad.record_id=row().record_id;if(change==='short-count')counts().login_attempt='3';if(change==='extra-count')counts().login_attempt='1';
  if(change==='page-cap')db.query.mockImplementation((sql,args)=>sql.includes('_page(')?{rows:Array.from({length:21},(_,i)=>row(i+1))}:answer(sql,args));
  await expect(createProviderEvidenceCollector(config)(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it('rejects a repeated first page rather than looping or publishing a mixed collection',async()=>{
  counts().login_attempt='40';db.query.mockImplementation((sql,args)=>sql.includes('_page(')&&args[3]==='login_attempt'?{rows:Array.from({length:20},(_,i)=>row(i+1))}:answer(sql,args));await expect(createProviderEvidenceCollector(config)(signal())).rejects.toThrow(error);expect(db.query).toHaveBeenCalledTimes(6);
});
it('accepts the exact 8MiB body budget and rejects one extra byte without truncation',async()=>{
  pages.inventory_observation=Array.from({length:32},(_,i)=>row(i+1,'x'.repeat(262144)));counts().inventory_observation='32';const read=createProviderEvidenceCollector(config);expect((await read(signal())).evidenceBytes).toBe(8*1024*1024);
  pages.login_attempt=[row(1,'x')];counts().login_attempt='1';await expect(read(signal())).rejects.toThrow(error);
});
it.each(['guard','begin','context','page','commit'])('redacts failures and never retries after %s',async point=>{
  db.query.mockImplementation((sql,args)=>{if(point==='guard'&&sql.startsWith('SELECT current_user')||point==='begin'&&sql.startsWith('BEGIN')||point==='context'&&sql.includes('_context(')||point==='page'&&sql.includes('_page(')||point==='commit'&&sql==='COMMIT')throw new Error('synthetic password SQL host token');return answer(sql,args);});
  const e=await createProviderEvidenceCollector(config)(signal()).catch(e=>e);expect(e.message).toBe(error);expect(e.cause).toBeUndefined();expect(db.configs).toHaveLength(1);expect(db.end).toHaveBeenCalledOnce();
});
it.each([[],[{allowed:false}],[{allowed:'true'}],[{allowed:true},{allowed:true}],[{allowed:true,extra:true}]].map(rows=>({rows})))('rejects invalid restricted-role guard %#',async({rows})=>{
  db.query.mockResolvedValueOnce({rows});await expect(createProviderEvidenceCollector(config)(signal())).rejects.toThrow(error);expect(db.query).toHaveBeenCalledOnce();
});
it.each(['ROLLBACK','',undefined])('requires a confirmed COMMIT command: %s',async command=>{
  db.query.mockImplementation((sql,args)=>sql==='COMMIT'?{command,rows:[]}:answer(sql,args));await expect(createProviderEvidenceCollector(config)(signal())).rejects.toThrow(error);
});
it('rejects pre-aborted work and concurrent calls before constructing another client',async()=>{
  const read=createProviderEvidenceCollector(config),cancel=new AbortController();cancel.abort();await expect(read(cancel.signal)).rejects.toThrow(error);expect(db.configs).toHaveLength(0);
  db.connect.mockImplementationOnce(()=>new Promise(()=>{}));const active=new AbortController(),p=read(active.signal);const failure=expect(p).rejects.toThrow(error);await expect(read(signal())).rejects.toThrow(error);expect(db.configs).toHaveLength(1);active.abort();await failure;
});
it.each(['connect','page','commit'])('cancels hanging %s and destroys its owned transport without waiting for end',async point=>{
  const cancel=new AbortController(),read=createProviderEvidenceCollector(config);db.end.mockImplementation(()=>new Promise(()=>{}));
  if(point==='connect')db.connect.mockImplementation(()=>new Promise(()=>{}));else db.query.mockImplementation((sql,args)=>point==='page'&&sql.includes('_page(')||point==='commit'&&sql==='COMMIT'?new Promise(()=>{}):answer(sql,args));
  const p=read(cancel.signal),failure=expect(p).rejects.toThrow(error);await vi.waitFor(()=>expect(db.query.mock.calls.some(c=>point==='page'?c[0].includes('_page('):c[0]==='COMMIT')||point==='connect').toBe(true));
  const socket=(db.configs[0]!.stream as ()=>{destroyed:boolean})(),destroy=vi.spyOn(socket as never,'destroy');cancel.abort();await failure;expect(destroy).toHaveBeenCalled();expect(socket.destroyed).toBe(true);expect(db.configs).toHaveLength(1);
});
it('bounds total lifetime even if individually successful pages keep progressing',async()=>{
  vi.useFakeTimers();counts().login_attempt='1000';pages.login_attempt=Array.from({length:1000},(_,i)=>row(i+1));db.query.mockImplementation(async(sql,args)=>{await new Promise(r=>setTimeout(r,1000));return answer(sql,args);});
  const p=createProviderEvidenceCollector(config)(signal()),failure=expect(p).rejects.toThrow(error);await vi.advanceTimersByTimeAsync(31000);await failure;expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it.each(['error','end'])('rejects an unexpected client %s while work is pending',async event=>{
  db.connect.mockImplementation(()=>new Promise(()=>{}));const p=createProviderEvidenceCollector(config)(signal()),failure=expect(p).rejects.toThrow(error);db.clients[0]!.events[event]!();await failure;expect(db.end).toHaveBeenCalled();
});
it('releases the instance after failure and starts a wholly new generation and context on an explicit new call',async()=>{
  const read=createProviderEvidenceCollector(config),first=await read(signal());db.query.mockRejectedValueOnce(new Error('synthetic'));await expect(read(signal())).rejects.toThrow(error);
  ctx.observedAt='2026-10-23T12:01:00+00:00';const last=await read(signal());expect(last.generationId).not.toBe(first.generationId);expect(last.context.observedAt).not.toBe(first.context.observedAt);expect(first.context.observedAt).toBe('2026-10-23T12:00:00.123456+00:00');expect(db.configs).toHaveLength(3);
});
it('does not await an unresponsive peer after a successful COMMIT',async()=>{db.end.mockImplementation(()=>new Promise(()=>{}));expect((await createProviderEvidenceCollector(config)(signal())).records).toEqual([]);});
it('snapshots configuration once and requires verified TLS in production',async()=>{
  const c={...config,environment:'production' as const,connectionString:'postgresql://u:p@db.example.com/crest',actorId:actorId.toUpperCase()},read=createProviderEvidenceCollector(c);c.issuer='https://changed.example.com';c.connectionString='invalid';await read(signal());expect(db.configs[0]).toMatchObject({ssl:{rejectUnauthorized:true},connectionString:'postgresql://u:p@db.example.com/crest'});expect(db.query.mock.calls[2]?.[1]).toEqual([actorId,issuer]);
});
it.each(['https://example.com/db','postgresql://u:p@localhost/crest_migrate_0000000000000000','postgresql://u:p@127.0.0.1/crest_test','postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000?sslmode=disable','postgresql://u@127.0.0.1/crest_migrate_0000000000000000'])('rejects unsafe configuration %s',connectionString=>{
  expect(()=>createProviderEvidenceCollector({...config,connectionString})).toThrow('PROVIDER_EVIDENCE_COLLECTION_CONFIGURATION_REQUIRED');expect(db.configs).toHaveLength(0);
});
it.each([{actorId:'invalid'},{issuer:'http://auth.example.com'},{issuer:'https://u:p@auth.example.com'},{issuer:'https://auth.example.com?secret=x'},{issuer:'https://auth.example.com#x'},{environment:'development'}])('rejects invalid trusted binding %j',change=>{
  expect(()=>createProviderEvidenceCollector({...config,...change} as typeof config)).toThrow('PROVIDER_EVIDENCE_COLLECTION_CONFIGURATION_REQUIRED');
});

const refKinds=['session_identity','session_event','cleanup_reference'];
function recovery(){
 const ref={...ctx,scope:'provider_session_references',snapshotToken:'b'.repeat(64),ledgerCounts:Object.fromEntries(refKinds.map(k=>[k,'0']))};
 const refPages:Record<string,Record<string,unknown>[]>={};
 const answerBoth=(sql:string,args:unknown[]=[])=>{
  if(sql.includes('provider_reference_export_context'))return {rows:[{result:ref}]};
  if(sql.includes('provider_reference_export_page'))return {rows:(refPages[args[3] as string]??[]).filter(r=>args[4]===null||(r.record_id as string)>(args[4] as string)).slice(0,20)};
  return answer(sql,args);
 };
 db.query.mockImplementation(answerBoth);return {ref,refPages,answerBoth};
}
it('format2 owns one connection two scoped contexts and all nine scans before confirmed COMMIT',async()=>{
 const f=recovery();for(const k of kinds){pages[k]=[row()];counts()[k]='1';}for(const k of refKinds){f.refPages[k]=[{...row(),representation:k==='session_event'?'stored_payload':'snapshot_projection'}];f.ref.ledgerCounts[k]='1';}
 const r=await createProviderRecoveryEvidenceCollector(config)(signal());expect(db.configs).toHaveLength(1);expect(r.formatVersion).toBe(2);expect(r.context).toEqual(ctx);expect(r.referenceContext).toEqual(f.ref);expect(r.records.map(r=>r.kind)).toEqual([...kinds,...refKinds]);expect(r.evidenceBytes).toBe(9*Buffer.byteLength(row().canonical_evidence));
 for(const v of [r,r.context,r.context.ledgerCounts,r.referenceContext,r.referenceContext.ledgerCounts,r.records,...r.records])expect(Object.isFrozen(v)).toBe(true);
 const calls=db.query.mock.calls;expect(calls[2]?.[0]).toContain('provider_evidence_export_context');expect(calls[3]?.[0]).toContain('provider_reference_export_context');expect(calls.at(-1)?.[0]).toBe('COMMIT');expect(calls.filter(c=>c[0].includes('_context('))).toHaveLength(2);
 for(const [i,k] of [...kinds,...refKinds].entries())expect(calls[i+4]?.[1]).toEqual([actorId,issuer,(i<6?'a':'b').repeat(64),k,null,20]);expect(db.end).toHaveBeenCalledOnce();
});
it('format2 keeps empty scopes explicit and uses no independent format1 collector or second snapshot',async()=>{
 recovery();const r=await createProviderRecoveryEvidenceCollector(config)(signal());expect(r.records).toEqual([]);expect(r.evidenceBytes).toBe(0);expect(db.query.mock.calls.filter(c=>c[0].startsWith('BEGIN'))).toHaveLength(1);expect(r).not.toHaveProperty('ready');
});
it('shares the1000-record allowance across contexts before reading any source page',async()=>{
 const f=recovery();counts().login_attempt='800';f.ref.ledgerCounts.session_event='201';await expect(createProviderRecoveryEvidenceCollector(config)(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0].includes('_page('))).toBe(false);
});
it('shares the8MiB byte allowance across both scopes without truncating either',async()=>{
 const f=recovery();pages.inventory_observation=Array.from({length:32},(_,i)=>row(i+1,'x'.repeat(262144)));counts().inventory_observation='32';f.refPages.session_event=[{...row(1,'x'),representation:'stored_payload'}];f.ref.ledgerCounts.session_event='1';await expect(createProviderRecoveryEvidenceCollector(config)(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it.each(['schemaVersion','scope','actorId','providerIssuer','snapshotToken','observedAt','ledgerCounts','extra'])('rejects bad second context %s without partial output',async key=>{
 const f=recovery();Object.assign(f.ref,{[key]:key==='schemaVersion'?2:'invalid'});await expect(createProviderRecoveryEvidenceCollector(config)(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0].includes('_page('))).toBe(false);
});
it.each(['01','-1','1001','1.0','999999999999999999999999999999'])('rejects malformed reference counts %s',async value=>{const f=recovery();f.ref.ledgerCounts.session_event=value;await expect(createProviderRecoveryEvidenceCollector(config)(signal())).rejects.toThrow(error);});
it.each(['representation','extra','hash','id','body-cap','utf8-cap','nul','surrogate','short-count','extra-count','duplicate','order'])('rejects malformed or mismatched reference row %s',async change=>{
 const f=recovery(),r={...row(1),representation:'stored_payload'};f.refPages.session_event=[r,{...row(2),representation:'stored_payload'}];f.ref.ledgerCounts.session_event='2';
 if(change==='representation')r.representation='snapshot_projection';if(change==='extra')Object.assign(r,{secret:'synthetic'});if(change==='hash')r.evidence_hash='0'.repeat(64);if(change==='id')r.record_id='invalid';
 if(['body-cap','utf8-cap','nul','surrogate'].includes(change))Object.assign(r,row(1,change==='body-cap'?'x'.repeat(8193):change==='utf8-cap'?'雪'.repeat(3000):change==='nul'?'\0':'\ud800'));
 if(change==='short-count')f.ref.ledgerCounts.session_event='3';if(change==='extra-count')f.ref.ledgerCounts.session_event='1';if(change==='duplicate')f.refPages.session_event[1]!.record_id=r.record_id;if(change==='order')f.refPages.session_event.reverse();await expect(createProviderRecoveryEvidenceCollector(config)(signal())).rejects.toThrow(error);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it('paginates all reference rows by exclusive original UUID without changing representations',async()=>{
 const f=recovery();f.refPages.session_event=Array.from({length:41},(_,i)=>({...row(i+1),representation:'stored_payload'}));f.ref.ledgerCounts.session_event='41';const r=await createProviderRecoveryEvidenceCollector(config)(signal());expect(r.records.map(r=>r.recordId)).toEqual(f.refPages.session_event.map(r=>r.record_id));expect(db.query.mock.calls.filter(c=>c[0].includes('provider_reference_export_page')&&c[1][3]==='session_event')).toHaveLength(3);
});
it.each(['context','page'])('cancels hanging reference %s and destroys its owned socket with no partial COMMIT',async point=>{
 const f=recovery(),cancel=new AbortController();db.end.mockImplementation(()=>new Promise(()=>{}));db.query.mockImplementation((sql,args)=>sql.includes('provider_reference_export_'+point)?new Promise(()=>{}):f.answerBoth(sql,args));const p=createProviderRecoveryEvidenceCollector(config)(cancel.signal),failure=expect(p).rejects.toThrow(error);
 await vi.waitFor(()=>expect(db.query.mock.calls.some(c=>c[0].includes('provider_reference_export_'+point))).toBe(true));const socket=(db.configs[0]!.stream as ()=>{destroyed:boolean})();cancel.abort();await failure;expect(socket.destroyed).toBe(true);expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it('rejects concurrent combined work and starts fresh after an explicit retry',async()=>{
 recovery();const read=createProviderRecoveryEvidenceCollector(config),first=await read(signal());db.connect.mockImplementationOnce(()=>new Promise(()=>{}));const c=new AbortController(),p=read(c.signal),failure=expect(p).rejects.toThrow(error);await expect(read(signal())).rejects.toThrow(error);c.abort();await failure;expect((await read(signal())).generationId).not.toBe(first.generationId);
});
