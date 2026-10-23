import {createHash,randomUUID} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const db=vi.hoisted(()=>({instances:[] as unknown[],query:vi.fn(),connect:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({default:{Client:class {
  constructor(config:unknown){db.instances.push(config);}
  on(){return this;}once(){return this;}
  connect(){return db.connect();}query(...args:unknown[]){return db.query(...args);}end(){return db.end();}
}}}));
import {createProviderCleanupExecutor,createProviderCleanupOutcomeReader,createProviderReconciliationReviewer,dispatchProviderCleanup} from '../../src/security/provider-cleanup-maintenance.ts';
const actorId=randomUUID(),issuer='https://auth.example.com/auth/v1';
const config={connectionString:'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000',environment:'test' as const,actorId,issuer};
const signal=()=>new AbortController().signal;
function saved(id:string=randomUUID(),outcome='provider_removed'){
  const e={schemaVersion:1,origin:'system',requestId:id,requestHash:'a'.repeat(64),actorId,securityEpoch:randomUUID(),providerIssuer:issuer,
    providerSubject:randomUUID(),providerSessionId:randomUUID(),appSessionId:null,sourceFinishId:randomUUID(),outcome,createdAt:'2026-10-23T05:00:00.123456+00:00',databasePrincipal:'synthetic_probe'};
  const canonicalEvidence=JSON.stringify(e),evidenceHash=createHash('sha256').update(canonicalEvidence).digest('hex');
  return {evidence:e,canonicalEvidence,evidenceHash};
}
function response(value:unknown){db.query.mockResolvedValueOnce({rows:[{allowed:true}]}).mockResolvedValueOnce({rows:[{result:value}]});}
beforeEach(()=>{vi.resetAllMocks();db.instances.length=0;db.connect.mockResolvedValue(undefined);db.end.mockResolvedValue(undefined);});
afterEach(()=>vi.useRealTimers());
it('does not wait indefinitely for a peer to acknowledge connection shutdown',async()=>{
  vi.useFakeTimers();db.end.mockImplementation(()=>new Promise(()=>{}));response(null);
  let completed=false;const pending=createProviderCleanupOutcomeReader(config)(randomUUID(),signal()).then(()=>{completed=true;});
  await vi.advanceTimersByTimeAsync(4500);expect(completed).toBe(true);await pending;
});
it.each(['https://example.com/db','postgresql://u:p@localhost/crest_migrate_0000000000000000','postgresql://u:p@127.0.0.1/crest_test',
  'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000?sslmode=disable','postgresql://u@127.0.0.1/crest_migrate_0000000000000000'])('rejects unsafe connection configuration %s',connectionString=>{
  expect(()=>createProviderCleanupExecutor({...config,connectionString})).toThrow('PROVIDER_CLEANUP_CONFIGURATION_REQUIRED');expect(db.instances).toHaveLength(0);
});
it.each([{actorId:'bad'},{issuer:'http://auth.example.com'},{issuer:'https://u:p@auth.example.com'},{issuer:'https://auth.example.com?key=secret'},{environment:'development'}])('rejects invalid trusted binding %j',change=>{
  expect(()=>createProviderCleanupExecutor({...config,...change} as typeof config)).toThrow('PROVIDER_CLEANUP_CONFIGURATION_REQUIRED');
});
it('rejects invalid IDs and pre-cancellation before opening connections',async()=>{
  const execute=createProviderCleanupExecutor(config),controller=new AbortController();controller.abort();
  await expect(execute('bad',signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');await expect(execute(randomUUID(),controller.signal)).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(db.instances).toHaveLength(0);
});
it('executes only fixed typed SQL and confirms exact original bytes and a frozen receipt',async()=>{
  const r=saved();response(r);const result=await createProviderCleanupExecutor(config)(r.evidence.requestId.toUpperCase(),signal());
  expect(result).toEqual({requestId:r.evidence.requestId,outcome:'provider_removed',canonicalEvidence:r.canonicalEvidence,evidenceHash:r.evidenceHash});expect(Object.isFrozen(result)).toBe(true);
  expect(db.query.mock.calls[1]).toEqual(['SELECT crest_commands.execute_provider_cleanup($1::uuid,$2::uuid,$3::text) AS result',[r.evidence.requestId.toUpperCase(),actorId,issuer]]);
  expect(db.instances[0]).toMatchObject({options:'-c role=crest_cleanup',ssl:false,statement_timeout:3000,lock_timeout:2000,query_timeout:3500});expect(db.end).toHaveBeenCalled();
});
it('uses independently restricted history SQL and treats null as only an observation',async()=>{
  response(null);expect(await createProviderCleanupOutcomeReader(config)(randomUUID(),signal())).toBeNull();expect(db.query.mock.calls[1]?.[0]).toContain('read_provider_cleanup_outcome');expect(db.instances[0]).toMatchObject({options:'-c role=crest_inventory'});
});
it('requires certificate verification for production connections',async()=>{
  const r=saved();response(r);await createProviderCleanupExecutor({...config,environment:'production',connectionString:'postgresql://u:p@db.example.com/crest'})(r.evidence.requestId,signal());expect(db.instances[0]).toMatchObject({ssl:{rejectUnauthorized:true}});
});
it('rejects forbidden or malformed runtime guard results before the command',async()=>{
  for(const rows of [[],[{allowed:false}],[{allowed:'true'}],[{allowed:true},{allowed:true}]]){
    db.query.mockResolvedValueOnce({rows});await expect(createProviderCleanupExecutor(config)(randomUUID(),signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');
  }expect(db.query).toHaveBeenCalledTimes(4);
});
it.each(['hash','body','actor','issuer','request','outcome','array-outcome','extra','oversize','malformed','projection'])('rejects invalid receipt %s without exporting data',async change=>{
  const r=saved();if(change==='hash')r.evidenceHash='0'.repeat(64);
  else if(change==='body')r.canonicalEvidence+=' ';
  else if(change==='projection')r.evidence.outcome='provider_absent_observed';
  else {
    const e:Record<string,unknown>=r.evidence;
    if(change==='actor')e.actorId=randomUUID();if(change==='issuer')e.providerIssuer='https://other.example.com';if(change==='request')e.requestId=randomUUID();
    if(change==='outcome')e.outcome='everything_clean';if(change==='array-outcome')e.outcome=['provider_removed'];if(change==='extra')e.accessToken='synthetic-should-never-escape';
    r.canonicalEvidence=change==='oversize'?'x'.repeat(8193):change==='malformed'?'{':JSON.stringify(e);r.evidenceHash=createHash('sha256').update(r.canonicalEvidence).digest('hex');
  }
  response(r);await expect(createProviderCleanupExecutor(config)(change==='request'?randomUUID():r.evidence.requestId,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');
});
it('strips all raw database details and never retries a lost command response',async()=>{
  db.query.mockResolvedValueOnce({rows:[{allowed:true}]}).mockRejectedValueOnce(new Error('synthetic password SQL provider token'));
  const error=await createProviderCleanupExecutor(config)(randomUUID(),signal()).catch(e=>e);
  expect(error.message).toBe('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(error.cause).toBeUndefined();expect(db.query).toHaveBeenCalledTimes(2);
});
it('bounds a stalled command and destroys the connection on cancellation',async()=>{
  vi.useFakeTimers();db.query.mockResolvedValueOnce({rows:[{allowed:true}]}).mockImplementationOnce(()=>new Promise(()=>{}));
  const pending=createProviderCleanupExecutor(config)(randomUUID(),signal()).catch(e=>e);await vi.advanceTimersByTimeAsync(4000);
  expect((await pending).message).toBe('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(db.end).toHaveBeenCalled();expect(db.query).toHaveBeenCalledTimes(2);
});
it.each([[],Array.from({length:11},()=>randomUUID()),['bad'],Array<string>(1)].map(ids=>({ids})))('rejects invalid batch selection before work $ids',async({ids})=>{
  const execute=vi.fn();await expect(dispatchProviderCleanup(ids,execute,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(execute).not.toHaveBeenCalled();
});
it('rejects case-insensitive duplicates before any work',async()=>{
  const id=randomUUID(),execute=vi.fn();await expect(dispatchProviderCleanup([id,id.toUpperCase()],execute,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(execute).not.toHaveBeenCalled();
});
it('rejects oversized selections before invoking an iterator or inspecting entries',async()=>{
  const ids=Array<string>(11),iterate=vi.fn(()=>{throw new Error('ITERATOR_MUST_NOT_RUN');}),read=vi.fn(()=>{throw new Error('ENTRY_MUST_NOT_RUN');}),execute=vi.fn();
  Object.defineProperty(ids,Symbol.iterator,{value:iterate});Object.defineProperty(ids,0,{get:read});
  await expect(dispatchProviderCleanup(ids,execute,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(iterate).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
});
it('copies only bounded indexed entries without adopting a custom iterator',async()=>{
  const id=randomUUID(),ids=[id],iterate=vi.fn(()=>{throw new Error('ITERATOR_MUST_NOT_RUN');}),r=saved(id);
  Object.defineProperty(ids,Symbol.iterator,{value:iterate});
  const execute=vi.fn().mockResolvedValue({requestId:id,outcome:'provider_removed',canonicalEvidence:r.canonicalEvidence,evidenceHash:r.evidenceHash});
  const result=await dispatchProviderCleanup(ids,execute,signal());expect(iterate).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledExactlyOnceWith(id,expect.any(AbortSignal));expect(result.results[0]?.requestId).toBe(id);expect(result.telemetry.confirmed).toBe(1);
});
it('redacts a selection accessor failure before any execution',async()=>{
  const ids=[randomUUID()],execute=vi.fn();Object.defineProperty(ids,0,{get:()=>{throw new Error('synthetic private selection detail');}});
  const error=await dispatchProviderCleanup(ids,execute,signal()).catch(e=>e);expect(error.message).toBe('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(error.cause).toBeUndefined();expect(execute).not.toHaveBeenCalled();
});
it('copies selection before awaits, runs sequentially and reports bounded counts',async()=>{
  const ids:string[]=[randomUUID(),randomUUID()],original=[...ids],events:string[]=[];
  const execute=vi.fn(async(id:string)=>{events.push(id);if(events.length===1)ids.splice(0,ids.length,randomUUID());const r=saved(id,events.length===1?'provider_removed':'provider_absent_observed');return {requestId:id,outcome:r.evidence.outcome as 'provider_removed'|'provider_absent_observed',canonicalEvidence:r.canonicalEvidence,evidenceHash:r.evidenceHash};});
  const result=await dispatchProviderCleanup(ids,execute,signal());expect(events).toEqual(original);expect(result.telemetry).toEqual({selected:2,started:2,confirmed:2,removed:1,absentObserved:1,unknown:0,notStarted:0});expect(Object.isFrozen(result.results)).toBe(true);expect(Object.isFrozen(result.telemetry)).toBe(true);
});
it('stops on an uncertain outcome and preserves original IDs without retry or history inference',async()=>{
  const ids=[randomUUID(),randomUUID(),randomUUID()],execute=vi.fn(async()=>{throw new Error('synthetic commit response lost');});
  const result=await dispatchProviderCleanup(ids,execute,signal());expect(execute).toHaveBeenCalledTimes(1);expect(result.results).toEqual(ids.map((requestId,i)=>({requestId,status:i===0?'outcome_unknown':'not_started'})));expect(result.telemetry).toMatchObject({unknown:1,notStarted:2,confirmed:0});expect(JSON.stringify(result)).not.toContain('response lost');
});
it('marks pre-cancelled selection not started without work',async()=>{
  const c=new AbortController();c.abort();const execute=vi.fn(),r=await dispatchProviderCleanup([randomUUID()],execute,c.signal);expect(execute).not.toHaveBeenCalled();expect(r.telemetry).toMatchObject({started:0,unknown:0,notStarted:1});
});
it('bounds an uncooperative dependency and ignores its late completion',async()=>{
  vi.useFakeTimers();let finish:(value:never)=>void=()=>{};
  const ids=[randomUUID(),randomUUID()],execute=vi.fn(()=>new Promise<never>(resolve=>{finish=resolve;}));
  const pending=dispatchProviderCleanup(ids,execute,signal());await vi.advanceTimersByTimeAsync(4000);const r=await pending;expect(r.results.map(x=>x.status)).toEqual(['outcome_unknown','not_started']);finish({requestId:ids[0]} as never);await Promise.resolve();expect(r.telemetry.confirmed).toBe(0);expect(execute).toHaveBeenCalledTimes(1);
});

function observed(state='target_unconfirmed_review'){
  const id=randomUUID(),ref={evidenceHash:'a'.repeat(64)},providerSessionId=randomUUID();
  const o={schemaVersion:1,observedAt:'2026-10-23T05:00:00.123456+00:00',attempt:{attemptId:id,actorId,providerIssuer:issuer,providerSubject:randomUUID(),securityEpoch:randomUUID(),appSessionId:randomUUID(),...ref},reviewState:state,
    registration:{state:'registration_unconfirmed',providerSessionId:null as string|null,localRevokedAt:null as string|null},
    target:null as null|Record<string,unknown>,registrationFinish:null as null|Record<string,unknown>,stop:null as null|Record<string,unknown>,request:null as null|Record<string,unknown>,outcome:null as null|Record<string,unknown>};
  if(!['binding_conflict_review','target_unconfirmed_review'].includes(state))o.target={providerSessionId,...ref};
  if(state==='registration_closed_recorded'){o.registration={state:'registration_recorded',providerSessionId,localRevokedAt:null};o.registrationFinish={finishId:randomUUID(),...ref};}
  if(['stopped_without_request_review','cleanup_outcome_unconfirmed_review','cleanup_outcome_recorded'].includes(state))o.stop={finishId:randomUUID(),...ref};
  if(['cleanup_outcome_unconfirmed_review','cleanup_outcome_recorded'].includes(state))o.request={requestId:randomUUID(),...ref};
  if(state==='cleanup_outcome_recorded')o.outcome={outcome:'provider_removed',...ref};
  return {attempt_id:id,observation:o};
}
function reviewResponse(rows:unknown){db.query.mockResolvedValueOnce({rows:[{allowed:true}]}).mockResolvedValueOnce({command:'BEGIN'}).mockResolvedValueOnce({rows}).mockResolvedValueOnce({command:'COMMIT'});}
it.each(['binding_conflict_review','target_unconfirmed_review','finish_unconfirmed_review','registration_closed_recorded','stopped_without_request_review','cleanup_outcome_unconfirmed_review','cleanup_outcome_recorded'])('reviews %s as historical facts through a fixed read-only inventory transaction',async state=>{
  const row=observed(state);reviewResponse([row]);const result=await createProviderReconciliationReviewer(config)(null,1,signal());
  expect(result).toEqual([row.observation]);expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result[0]?.attempt)).toBe(true);expect(Object.isFrozen(result[0]?.registration)).toBe(true);
  expect(db.instances[0]).toMatchObject({options:'-c role=crest_inventory',application_name:'crest_reconciliation_review'});
  expect(db.query.mock.calls.slice(1)).toEqual([['BEGIN READ ONLY ISOLATION LEVEL READ COMMITTED'],['SELECT * FROM crest_commands.provider_reconciliation_review($1::uuid,$2::text,$3::uuid,$4::integer)',[actorId,issuer,null,1]],['COMMIT']]);
  row.observation.attempt.evidenceHash='b'.repeat(64);expect(result[0]?.attempt.evidenceHash).toBe('a'.repeat(64));
});
it('preserves absence versus removal and both original finish references',async()=>{
  const row=observed('cleanup_outcome_recorded');row.observation.outcome!.outcome='provider_absent_observed';row.observation.registrationFinish={finishId:randomUUID(),evidenceHash:'b'.repeat(64)};reviewResponse([row]);
  const r=(await createProviderReconciliationReviewer(config)(null,100,signal()))[0]!;expect(r.outcome?.outcome).toBe('provider_absent_observed');expect(r.stop?.evidenceHash).toBe('a'.repeat(64));expect(r.registrationFinish?.evidenceHash).toBe('b'.repeat(64));expect(Object.isFrozen(r.outcome)).toBe(true);
});
it.each([[null,0],[null,101],[null,1.5],[null,NaN],['bad',1],[undefined,1]])('rejects review bounds before opening a connection (%s,%s)',async(cursor,size)=>{
  await expect(createProviderReconciliationReviewer(config)(cursor as string|null,size as number,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(db.instances).toHaveLength(0);
});
it('pre-cancellation opens no review connection',async()=>{const c=new AbortController();c.abort();await expect(createProviderReconciliationReviewer(config)(null,1,c.signal)).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(db.instances).toHaveLength(0);});
it('copies trusted configuration and normalizes the exclusive cursor without advancing it automatically',async()=>{
  const mutable={...config},review=createProviderReconciliationReviewer(mutable),cursor=randomUUID();mutable.actorId=randomUUID();mutable.issuer='https://changed.example.com';reviewResponse([]);
  expect(await review(cursor.toUpperCase(),100,signal())).toEqual([]);expect(db.query.mock.calls[2]?.[1]).toEqual([actorId,issuer,cursor,100]);expect(db.query).toHaveBeenCalledTimes(4);
});
it('validates and copies at most one hundred ordered observations',async()=>{
  const rows=Array.from({length:100},(_,i)=>{const row=observed();row.attempt_id=`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`;row.observation.attempt.attemptId=row.attempt_id;return row;});reviewResponse(rows);
  expect(await createProviderReconciliationReviewer(config)(null,100,signal())).toHaveLength(100);
});
it.each([
  (r:ReturnType<typeof observed>)=>{r.observation.attempt.actorId=randomUUID();},
  (r:ReturnType<typeof observed>)=>{r.observation.attempt.providerIssuer='https://other.example.com';},
  (r:ReturnType<typeof observed>)=>{r.observation.attempt.attemptId=randomUUID();},
  (r:ReturnType<typeof observed>)=>{r.observation.attempt.evidenceHash='bad';},
  (r:ReturnType<typeof observed>)=>{r.observation.schemaVersion=2;},
  (r:ReturnType<typeof observed>)=>{r.observation.observedAt='2026-10-23T05:00:00-04:00';},
  (r:ReturnType<typeof observed>)=>{r.observation.reviewState='safe_to_delete';},
  (r:ReturnType<typeof observed>)=>{Object.assign(r.observation,{secret:'must not escape'});},
  (r:ReturnType<typeof observed>)=>{r.observation.registration.providerSessionId=randomUUID();},
  (r:ReturnType<typeof observed>)=>{r.observation.registration.state='registration_recorded';},
  (r:ReturnType<typeof observed>)=>{r.observation.request={requestId:randomUUID(),evidenceHash:'a'.repeat(64)};},
  (r:ReturnType<typeof observed>)=>{r.observation.outcome={outcome:'provider_removed',evidenceHash:'a'.repeat(64)};},
  (r:ReturnType<typeof observed>)=>{r.observation.stop={finishId:'bad',evidenceHash:'a'.repeat(64)};},
])('rejects malformed, unbound or contradictory review output without committing (%#)',async mutate=>{
  const row=observed();mutate(row);reviewResponse([row]);await expect(createProviderReconciliationReviewer(config)(null,1,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');expect(db.query.mock.calls.some(c=>c[0]==='COMMIT')).toBe(false);
});
it('rejects conflict output that discloses suppressed linked facts',async()=>{const row=observed('binding_conflict_review');row.observation.target={providerSessionId:randomUUID(),evidenceHash:'a'.repeat(64)};reviewResponse([row]);await expect(createProviderReconciliationReviewer(config)(null,1,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');});
it.each(['duplicate','reversed','cursor','oversize','extra-row-key'])('rejects invalid page boundaries: %s',async mode=>{
  const a=observed(),b=observed();const rows=[a,b].sort((x,y)=>x.attempt_id.localeCompare(y.attempt_id));let cursor:string|null=null,size=2;
  if(mode==='duplicate')rows[1]=rows[0]!;if(mode==='reversed')rows.reverse();if(mode==='cursor')cursor=rows[0]!.attempt_id;if(mode==='oversize')size=1;if(mode==='extra-row-key')Object.assign(rows[0]!,{secret:'redacted'});
  reviewResponse(rows);await expect(createProviderReconciliationReviewer(config)(cursor,size,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');
});
it('a failed or rolled-back read transaction publishes no partial observation',async()=>{
  reviewResponse([observed()]);db.query.mockReset();db.query.mockResolvedValueOnce({rows:[{allowed:true}]}).mockResolvedValueOnce({command:'BEGIN'}).mockResolvedValueOnce({rows:[observed()]}).mockResolvedValueOnce({command:'ROLLBACK'});
  await expect(createProviderReconciliationReviewer(config)(null,1,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');
});
it('a stalled review obeys the deadline, redacts errors and never retries',async()=>{
  vi.useFakeTimers();db.query.mockResolvedValueOnce({rows:[{allowed:true}]}).mockResolvedValueOnce({command:'BEGIN'}).mockImplementationOnce(()=>new Promise(()=>{}));
  const pending=createProviderReconciliationReviewer(config)(null,1,signal()),checked=expect(pending).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');await vi.advanceTimersByTimeAsync(4000);await checked;expect(db.query).toHaveBeenCalledTimes(3);
});
it('destroys its owned transport even if graceful peer shutdown never finishes',async()=>{
  db.end.mockImplementation(()=>new Promise(()=>{}));reviewResponse([]);const pending=createProviderReconciliationReviewer(config)(null,1,signal());
  const socket=(db.instances[0] as {stream:()=>import('node:net').Socket}).stream();await pending;expect(socket.destroyed).toBe(true);
});

it.each(['registration','outcome'])('rejects an array masquerading as the %s enum',async part=>{
 const row=observed(part==='outcome'?'cleanup_outcome_recorded':'target_unconfirmed_review');if(part==='registration')Object.assign(row.observation.registration,{state:['registration_unconfirmed']});else row.observation.outcome!.outcome=['provider_removed'];reviewResponse([row]);
 await expect(createProviderReconciliationReviewer(config)(null,1,signal())).rejects.toThrow('PROVIDER_CLEANUP_REVIEW_REQUIRED');
});
