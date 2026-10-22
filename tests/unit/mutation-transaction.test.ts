import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({verify:vi.fn(),transaction:vi.fn(),query:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>({commandTransaction:mock.transaction})}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createMutationTransaction,MutationBoundaryError} from '../../src/security/mutation-transaction';
const actor=randomUUID(),business=randomUUID(),session=randomUUID(),epoch=randomUUID(),subject=randomUUID(),providerSession=randomUUID();
const credential=randomBytes(32).toString('base64url'),signal=()=>new AbortController().signal;
const input=()=>({businessId:business,recoveryEpoch:epoch});
const proof=()=>({sessionId:session,actorId:actor,provider:{issuer:'https://auth.example.com/auth/v1',subject,sessionId:providerSession,expiresAt:Date.now()+60000}});
const context=()=>({actorId:actor,businessId:business,sessionId:session,recoveryEpoch:epoch,capability:'crm.manage'});
const config={connectionString:'unused-by-mock',environment:'test' as const};
const provider={} as Parameters<typeof createMutationTransaction>[2],tokens={} as Parameters<typeof createMutationTransaction>[3];
const factory=(policy:Parameters<typeof createMutationTransaction>[1]={capability:'crm.manage',requireRecentAuth:false})=>createMutationTransaction(config,policy,provider,tokens);
beforeEach(()=>{
  vi.clearAllMocks();mock.events.length=0;mock.verify.mockImplementation(async()=>{mock.events.push('verify');return proof();});
  mock.query.mockImplementation(async()=>{mock.events.push('fence');return context();});
  mock.transaction.mockImplementation(async(work,currentSignal)=>{mock.events.push('begin');const value=await work(mock.query,currentSignal);mock.events.push('commit');return value;});
});
it('verifies before the transaction, fences before work, and returns only after commit',async()=>{
  const run=factory();expect(await run(credential,input(),async scope=>{mock.events.push('work');expect(scope.contextForServer()).toEqual(context());expect(Object.isFrozen(scope.contextForServer())).toBe(true);expect(()=>JSON.stringify(scope)).toThrow(MutationBoundaryError);return 'confirmed';},signal())).toBe('confirmed');
  expect(mock.events).toEqual(['verify','begin','fence','work','commit']);expect(mock.query).toHaveBeenCalledTimes(1);
  const [sql,values]=mock.query.mock.calls[0]!;expect(sql).toContain('SELECT crest_commands.lock_mutation_authority(');expect(values.slice(1,6)).toEqual([session,actor,'https://auth.example.com/auth/v1',subject,providerSession]);expect(values.slice(7)).toEqual([business,epoch,'crm.manage',false]);expect([...values[0]]).toEqual(Array(32).fill(0));
});
it.each(['identity.read','recovery.authorize','unsupported',null])('rejects invalid static capability %s',capability=>{
  expect(()=>factory({capability,requireRecentAuth:false} as Parameters<typeof factory>[0])).toThrow('MUTATION_POLICY_CONFIGURATION_REQUIRED');
});
it('snapshots trusted policy and forces recent authentication for bulk exports',async()=>{
  const policy={capability:'export.bulk' as const,requireRecentAuth:false},run=factory(policy);policy.requireRecentAuth=true;
  mock.query.mockResolvedValue({...context(),capability:'export.bulk'});await run(credential,input(),async()=>null,signal());
  expect(mock.verify).toHaveBeenCalledWith(credential,expect.any(AbortSignal),'background',true);expect(mock.query.mock.calls[0]![1].slice(9)).toEqual(['export.bulk',true]);
});
it('rejects extra caller authority fields and malformed/cancelled inputs before IO',async()=>{
  const controller=new AbortController();controller.abort();
  for(const value of [{...input(),capability:'finance.post'},{...input(),recoveryEpoch:'invalid'},{businessId:business},null])await expect(factory()(credential,value as ReturnType<typeof input>,async()=>null,signal())).rejects.toThrow(MutationBoundaryError);
  await expect(factory()(credential,input(),async()=>null,controller.signal)).rejects.toThrow(MutationBoundaryError);expect(mock.verify).not.toHaveBeenCalled();expect(mock.transaction).not.toHaveBeenCalled();
});
it('pins request epoch and business before awaits rather than re-reading mutable caller input',async()=>{
  const value=input();mock.verify.mockImplementation(async()=>{value.recoveryEpoch=randomUUID();value.businessId=randomUUID();return proof();});
  await factory()(credential,value,async()=>null,signal());expect(mock.query.mock.calls[0]![1].slice(7,9)).toEqual([business,epoch]);
});
it('recovery review stops before callback and never retries or fetches a replacement epoch',async()=>{
  mock.query.mockRejectedValue(new Error('RECOVERY_REVIEW_REQUIRED'));const work=vi.fn();
  await expect(factory()(credential,input(),work,signal())).rejects.toThrow('RECOVERY_REVIEW_REQUIRED');expect(work).not.toHaveBeenCalled();expect(mock.query).toHaveBeenCalledTimes(1);expect(mock.transaction).toHaveBeenCalledTimes(1);
});
it.each([null,{...context(),extra:true},{...context(),actorId:randomUUID()},{...context(),businessId:randomUUID()},{...context(),sessionId:randomUUID()},{...context(),recoveryEpoch:randomUUID()},{...context(),capability:'finance.post'}])('rejects malformed or mismatched fenced context before work',async value=>{
  mock.query.mockResolvedValue(value);const work=vi.fn();await expect(factory()(credential,input(),work,signal())).rejects.toThrow(MutationBoundaryError);expect(work).not.toHaveBeenCalled();
});
it('a captured query cannot run after commit or rollback',async()=>{
  for(const fail of [false,true]){
    let captured:Parameters<Parameters<ReturnType<typeof factory>>[2]>[0]|undefined;
    const result=factory()(credential,input(),async scope=>{captured=scope;if(fail)throw new Error('private detail');return null;},signal());
    if(fail)await expect(result).rejects.toThrow('MUTATION_BOUNDARY_FAILED');else await result;
    const calls=mock.query.mock.calls.length;await expect(captured!.query('SELECT 1 AS result',[])).rejects.toThrow(MutationBoundaryError);expect(mock.query).toHaveBeenCalledTimes(calls);
  }
});
it('unfinished callback queries prevent commit and cannot be silently detached',async()=>{
  let release:((value:unknown)=>void)|undefined;const pending=new Promise(resolve=>{release=resolve;});
  mock.query.mockImplementationOnce(async()=>context()).mockImplementationOnce(()=>pending);
  await expect(factory()(credential,input(),async scope=>{void scope.query('SELECT 1 AS result',[]);return 'early';},signal())).rejects.toThrow(MutationBoundaryError);
  expect(mock.events).not.toContain('commit');release!(null);
});
it('a swallowed statement failure still invalidates the scope and prevents commit',async()=>{
  mock.query.mockImplementationOnce(async()=>context()).mockRejectedValueOnce(new Error('private statement error'));
  await expect(factory()(credential,input(),async scope=>{try{await scope.query('SELECT failing AS result',[]);}catch{/* accidental caller swallow */}return 'incorrect success';},signal())).rejects.toThrow(MutationBoundaryError);
  expect(mock.events).not.toContain('commit');
});
it('provider, callback and commit failures remain fixed and are never retried',async()=>{
  mock.verify.mockRejectedValueOnce(new Error('private provider detail'));await expect(factory()(credential,input(),async()=>null,signal())).rejects.toThrow('MUTATION_BOUNDARY_FAILED');expect(mock.transaction).not.toHaveBeenCalled();
  const work=vi.fn(async()=>{throw new Error('private SQL detail');});await expect(factory()(credential,input(),work,signal())).rejects.toThrow('MUTATION_BOUNDARY_FAILED');expect(work).toHaveBeenCalledTimes(1);
  mock.transaction.mockRejectedValueOnce(new Error('private commit detail'));const error=await factory()(credential,input(),async()=>null,signal()).catch((error:unknown)=>error);expect(error).toMatchObject({message:'MUTATION_BOUNDARY_FAILED'});expect(error).not.toHaveProperty('cause');
});
