import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({verify:vi.fn(),transaction:vi.fn(),query:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>({commandTransaction:mock.transaction})}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createBusinessNameCommand,BusinessNameCommandError} from '../../src/security/business-name-command';
const business=randomUUID(),operation=randomUUID(),epoch=randomUUID(),session=randomUUID(),actor=randomUUID(),subject=randomUUID(),providerSession=randomUUID(),audit=randomUUID();
const credential=randomBytes(32).toString('base64url'),signal=()=>new AbortController().signal;
const input=()=>({schemaVersion:1 as const,businessId:business,operationId:operation,recoveryEpoch:epoch,expectedVersion:'1',legalName:'Synthetic name'});
const receipt=()=>({schemaVersion:1,businessId:business,businessVersion:'2',auditEventId:audit});
const committed=()=>({state:'committed',operationId:operation,recoveryEpoch:epoch,receipt:receipt()});
const proof=()=>({sessionId:session,actorId:actor,provider:{issuer:'https://auth.example.com/auth/v1',subject,sessionId:providerSession,expiresAt:Date.now()+60000}});
const factory=()=>createBusinessNameCommand({connectionString:'unused-by-mock',environment:'test'},{} as Parameters<typeof createBusinessNameCommand>[1],{} as Parameters<typeof createBusinessNameCommand>[2]);
beforeEach(()=>{
  vi.clearAllMocks();mock.events.length=0;mock.verify.mockImplementation(async()=>{mock.events.push('verify');return proof();});
  mock.query.mockImplementation(async()=>{mock.events.push('command');return committed();});
  mock.transaction.mockImplementation(async(work,currentSignal)=>{mock.events.push('begin');const value=await work(mock.query,currentSignal);mock.events.push('commit');return value;});
});
it('freshly verifies, runs only the typed command and exposes immutable evidence after commit',async()=>{
  const result=await factory()(credential,input(),signal());expect(mock.events).toEqual(['verify','begin','command','commit']);expect(result.forServer()).toEqual(committed());
  expect(mock.verify).toHaveBeenCalledWith(credential,expect.any(AbortSignal),'background',false);
  const [sql,values]=mock.query.mock.calls[0]!;expect(sql).toContain('SELECT crest_commands.rename_business(');expect(sql).not.toContain('lock_mutation_authority');
  expect(values.slice(1,6)).toEqual([session,actor,'https://auth.example.com/auth/v1',subject,providerSession]);expect(values.slice(7)).toEqual([business,epoch,operation,1,'1','Synthetic name']);expect([...values[0]]).toEqual(Array(32).fill(0));
  expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.forServer())).toBe(true);const v=result.forServer();if(v.state==='committed')expect(Object.isFrozen(v.receipt)).toBe(true);expect(()=>JSON.stringify(result)).toThrow(BusinessNameCommandError);expect(()=>JSON.stringify(result)).toThrow('BUSINESS_RENAME_RESULT_PRIVATE');
});
it('pins every meaningful input before awaits and does not cache verification or retry',async()=>{const request=input(),run=factory();mock.verify.mockImplementationOnce(async()=>{Object.assign(request,{businessId:randomUUID(),operationId:randomUUID(),recoveryEpoch:randomUUID(),expectedVersion:'7',legalName:'changed'});return proof();});await run(credential,request,signal());expect(mock.query.mock.calls[0]![1].slice(7)).toEqual([business,epoch,operation,1,'1','Synthetic name']);await run(credential,input(),signal());expect(mock.verify).toHaveBeenCalledTimes(2);expect(mock.transaction).toHaveBeenCalledTimes(2);});
it('rejects malformed/extra authority fields, noncanonical versions and invalid Unicode before IO',async()=>{
  for(const value of [null,{}, {...input(),capability:'finance.post'},{...input(),schemaVersion:2},{...input(),businessId:'bad'},{...input(),operationId:'bad'},{...input(),recoveryEpoch:'bad'},
    ...['0','01','1.0','1e3','9223372036854775808'].map(expectedVersion=>({...input(),expectedVersion})),
    ...['','   ','x'.repeat(201),'\0','\ud800','\udfff'].map(legalName=>({...input(),legalName}))])await expect(factory()(credential,value as ReturnType<typeof input>,signal())).rejects.toThrow('BUSINESS_RENAME_INPUT_REQUIRED');
  expect(mock.verify).not.toHaveBeenCalled();expect(mock.transaction).not.toHaveBeenCalled();
});
it('preserves valid Unicode and exact spaces without implicit normalization',async()=>{const request={...input(),legalName:' '+String.fromCodePoint(0x1f600).repeat(198)+' '};await factory()(credential,request,signal());expect(mock.query.mock.calls[0]![1][12]).toBe(request.legalName);});
it('accepts int64 versions as decimal strings without Number conversion',async()=>{const request={...input(),expectedVersion:'9007199254740993'};mock.query.mockResolvedValue({...committed(),receipt:{...receipt(),businessVersion:'9007199254740994'}});const r=await factory()(credential,request,signal());expect(r.forServer()).toMatchObject({receipt:{businessVersion:'9007199254740994'}});expect(mock.query.mock.calls[0]![1][11]).toBe('9007199254740993');});
it.each([{state:'conflict',reason:'operation'},{state:'conflict',reason:'version',currentVersion:'9007199254740993'}])('returns a strict conflict without inventing a new operation or epoch',async value=>{mock.query.mockResolvedValue(value);expect((await factory()(credential,input(),signal())).forServer()).toEqual(value);expect(mock.query).toHaveBeenCalledTimes(1);});
it('returns fixed denied evidence without confusing it with an ambiguous commit',async()=>{mock.query.mockResolvedValue({state:'denied'});await expect(factory()(credential,input(),signal())).rejects.toThrow('BUSINESS_RENAME_DENIED');expect(mock.events).toEqual(['verify','begin','commit']);});
it('stops pre-submission cancellation or verification failure without starting a command',async()=>{const c=new AbortController();c.abort();await expect(factory()(credential,input(),c.signal)).rejects.toThrow('BUSINESS_RENAME_NOT_SUBMITTED');mock.verify.mockRejectedValueOnce(new Error('private JWT'));const error=await factory()(credential,input(),signal()).catch((e:unknown)=>e);expect(error).toMatchObject({message:'BUSINESS_RENAME_NOT_SUBMITTED'});expect(error).not.toHaveProperty('cause');expect(mock.transaction).not.toHaveBeenCalled();});
it('checks cancellation again after provider verification',async()=>{const c=new AbortController();mock.verify.mockImplementationOnce(async()=>{c.abort();return proof();});await expect(factory()(credential,input(),c.signal)).rejects.toThrow('BUSINESS_RENAME_NOT_SUBMITTED');expect(mock.transaction).not.toHaveBeenCalled();});
it('requires commit acknowledgement and does not return an already-computed receipt on failure',async()=>{mock.transaction.mockImplementationOnce(async(work,s)=>{await work(mock.query,s);throw new Error('private lost COMMIT response');});const error=await factory()(credential,input(),signal()).catch((e:unknown)=>e);expect(error).toMatchObject({message:'BUSINESS_RENAME_OUTCOME_UNKNOWN'});expect(error).not.toHaveProperty('cause');expect(mock.query).toHaveBeenCalledTimes(1);expect(mock.transaction).toHaveBeenCalledTimes(1);expect([...mock.query.mock.calls[0]![1][0]]).toEqual(Array(32).fill(0));});
it('preserves only the fixed recovery-review error without fetching a new epoch',async()=>{mock.transaction.mockRejectedValue(new Error('RECOVERY_REVIEW_REQUIRED'));await expect(factory()(credential,input(),signal())).rejects.toThrow('RECOVERY_REVIEW_REQUIRED');expect(mock.verify).toHaveBeenCalledTimes(1);expect(mock.transaction).toHaveBeenCalledTimes(1);});
it('treats cancellation after dispatch as unknown, never a confirmed success or an automatic retry',async()=>{const c=new AbortController();mock.query.mockImplementationOnce(async()=>{c.abort();return committed();});await expect(factory()(credential,input(),c.signal)).rejects.toThrow('BUSINESS_RENAME_OUTCOME_UNKNOWN');expect(mock.events).not.toContain('commit');expect(mock.query).toHaveBeenCalledTimes(1);});
it.each([null,{state:'denied',extra:true},{state:'conflict',reason:'version',currentVersion:'0'},{state:'conflict',reason:'version',currentVersion:'9223372036854775808'},
  {...committed(),operationId:randomUUID()},{...committed(),recoveryEpoch:randomUUID()},{...committed(),extra:true},
  {...committed(),receipt:{...receipt(),businessId:randomUUID()}},{...committed(),receipt:{...receipt(),businessVersion:2}},
  {...committed(),receipt:{...receipt(),businessVersion:'3'}},{...committed(),receipt:{...receipt(),businessVersion:'9223372036854775808'}},
  {...committed(),receipt:{...receipt(),schemaVersion:2}},{...committed(),receipt:{...receipt(),auditEventId:'bad'}},{...committed(),receipt:{...receipt(),extra:true}}])('rejects malformed results inside the transaction before commit',async value=>{mock.query.mockResolvedValue(value);await expect(factory()(credential,input(),signal())).rejects.toThrow('BUSINESS_RENAME_OUTCOME_UNKNOWN');expect(mock.events).not.toContain('commit');expect(mock.query).toHaveBeenCalledTimes(1);});
