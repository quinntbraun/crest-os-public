import {createHash,randomUUID} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const db=vi.hoisted(()=>({instances:[] as unknown[],query:vi.fn(),connect:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({default:{Client:class {
  constructor(config:unknown){db.instances.push(config);}
  on(){return this;}once(){return this;}
  connect(){return db.connect();}query(...args:unknown[]){return db.query(...args);}end(){return db.end();}
}}}));
import {createProviderCleanupExecutor,createProviderCleanupOutcomeReader,dispatchProviderCleanup} from '../../src/security/provider-cleanup-maintenance.ts';
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
it.each(['hash','body','actor','issuer','request','outcome','extra','oversize','malformed','projection'])('rejects invalid receipt %s without exporting data',async change=>{
  const r=saved();if(change==='hash')r.evidenceHash='0'.repeat(64);
  else if(change==='body')r.canonicalEvidence+=' ';
  else if(change==='projection')r.evidence.outcome='provider_absent_observed';
  else {
    const e:Record<string,unknown>=r.evidence;
    if(change==='actor')e.actorId=randomUUID();if(change==='issuer')e.providerIssuer='https://other.example.com';if(change==='request')e.requestId=randomUUID();
    if(change==='outcome')e.outcome='everything_clean';if(change==='extra')e.accessToken='synthetic-should-never-escape';
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
