import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({verify:vi.fn(),read:vi.fn(),query:vi.fn(),transaction:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>Object.assign(mock.read,{commandTransaction:mock.transaction})}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createOriginalOperationDirectory} from '../../src/security/original-operation-directory';
import {parseOriginalOperationReference} from '../../src/security/original-operation-reference';

const businessId=randomUUID(),operationId=randomUUID(),originalEpoch=randomUUID(),authorityEpoch=randomUUID();
const credential=randomBytes(32).toString('base64url');
const original=()=>parseOriginalOperationReference({schemaVersion:1,businessId,commandType:'crm.customer.save',reference:{operationId,recoveryEpoch:originalEpoch,customerId:randomUUID(),expectedVersion:'0'}});
const intent=()=>({schemaVersion:1,recoveryEpoch:authorityEpoch,original:original(),reason:' Owner reviewed lost draft é 😀\nRetire only this original. '});
const retired=(request:ReturnType<typeof intent>)=>({schemaVersion:1,state:'retired',original:request.original,retirement:{operationRowId:randomUUID(),auditEventId:randomUUID(),recoveryEpoch:request.recoveryEpoch,reason:request.reason,recordedAt:'2026-10-25T01:02:03.123456Z'}});
const signal=()=>new AbortController().signal;
const factory=()=>createOriginalOperationDirectory({connectionString:'mock',environment:'test'},{} as never,{} as never);
const verified=()=>({sessionId:randomUUID(),actorId:randomUUID(),provider:{issuer:'https://auth.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60000}});
beforeEach(()=>{
 vi.resetAllMocks();mock.events.length=0;
 mock.verify.mockImplementation(async()=>{mock.events.push('verify');return verified();});
 mock.transaction.mockImplementation(async(work,bounded)=>{mock.events.push('begin');const result=await work(mock.query,bounded);mock.events.push('commit');return result;});
 mock.query.mockImplementation(async(_sql,args)=>retired({schemaVersion:1,recoveryEpoch:args[8],original:args[9],reason:args[10]}));
 mock.read.mockResolvedValue({state:'absent'});
});

it('requires recent genuine identity and exposes one fixed decision only after the transaction commits',async()=>{
 const request=intent(),result=await factory().retire(credential,request,signal());
 expect(mock.events).toEqual(['verify','begin','commit']);expect(result.forServer()).toMatchObject({state:'retired',original:request.original,retirement:{recoveryEpoch:authorityEpoch,reason:request.reason}});
 expect(()=>JSON.stringify(result)).toThrow('ORIGINAL_OPERATION_VALUE_PRIVATE');expect(Object.keys(result)).toEqual([]);expect(Object.isFrozen(result)).toBe(true);
 expect(mock.verify.mock.calls[0]!.slice(2)).toEqual(['background',true]);expect(mock.query).toHaveBeenCalledTimes(1);
 const [sql,args]=mock.query.mock.calls[0]!;expect(sql).toBe('SELECT crest_commands.retire_original_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::jsonb,$11::text) AS result');
 expect(args.slice(7)).toEqual([businessId,authorityEpoch,request.original,request.reason]);expect(args[9].reference.recoveryEpoch).toBe(originalEpoch);expect([...args[0]]).toEqual(Array(32).fill(0));
});
it('pins original metadata and review before awaiting provider verification',async()=>{
 const request=structuredClone(intent()),expected=structuredClone(request);
 mock.verify.mockImplementationOnce(async()=>{request.reason='Changed';request.recoveryEpoch=randomUUID();Object.assign(request.original.reference,{operationId:randomUUID()});return verified();});
 const result=await factory().retire(credential,request,signal());expect(mock.query.mock.calls[0]![1].slice(7)).toEqual([businessId,expected.recoveryEpoch,expected.original,expected.reason]);expect(result.forServer()).toMatchObject({original:expected.original,retirement:{reason:expected.reason}});
});
it('returns an existing original observation without claiming a receipt or issuing another command',async()=>{
 const request=intent(),observation={schemaVersion:1,state:'original_recorded',original:request.original};mock.query.mockResolvedValueOnce(observation);
 expect((await factory().retire(credential,request,signal())).forServer()).toEqual(observation);expect(mock.query).toHaveBeenCalledTimes(1);expect(mock.read).not.toHaveBeenCalled();
});
it('returns only the fixed definite operation conflict after an acknowledged transaction',async()=>{
 mock.query.mockResolvedValueOnce({state:'conflict',reason:'operation'});expect((await factory().retire(credential,intent(),signal())).forServer()).toEqual({state:'conflict',reason:'operation'});expect(mock.events.at(-1)).toBe('commit');
});
it.each(['reason','epoch','original','audit','timestamp','extra','absent','denied','unknown conflict','private conflict'])('treats invalid %s retirement evidence as unknown and never releases it',async issue=>{
 const request=intent(),value:Record<string,unknown>=retired(request),receipt=value.retirement as Record<string,unknown>;
 if(issue==='reason')receipt.reason='Substituted';if(issue==='epoch')receipt.recoveryEpoch=randomUUID();if(issue==='original')value.original=original();if(issue==='audit')receipt.auditEventId='invalid';if(issue==='timestamp')receipt.recordedAt='yesterday';if(issue==='extra')value.details='Private detail';
 if(issue==='absent'||issue==='denied')mock.query.mockResolvedValueOnce({state:issue});else if(issue==='unknown conflict')mock.query.mockResolvedValueOnce({state:'conflict',reason:'other'});else if(issue==='private conflict')mock.query.mockResolvedValueOnce({state:'conflict',reason:'operation',detail:'Private detail'});else mock.query.mockResolvedValueOnce(value);
 const error=await factory().retire(credential,request,signal()).catch(e=>e);expect(error.message).toBe('ORIGINAL_OPERATION_OUTCOME_UNKNOWN');expect(error).not.toHaveProperty('cause');expect(mock.events).not.toContain('commit');expect(mock.query).toHaveBeenCalledTimes(1);
});
it.each(['input','credential','provider','already aborted','aborted during verify'])('rejects %s before submitting a retirement',async issue=>{
 const request=intent(),controller=new AbortController();let cookie=credential;
 if(issue==='input')Object.assign(request,{draft:'Forbidden'});if(issue==='credential')cookie='invalid';if(issue==='provider')mock.verify.mockRejectedValueOnce(new Error('Private provider detail'));if(issue==='already aborted')controller.abort();if(issue==='aborted during verify')mock.verify.mockImplementationOnce(async()=>{controller.abort();return verified();});
 const error=await factory().retire(cookie,request,controller.signal).catch(e=>e);expect(error.message).toBe('ORIGINAL_OPERATION_NOT_SUBMITTED');expect(error).not.toHaveProperty('cause');expect(mock.transaction).not.toHaveBeenCalled();expect(mock.query).not.toHaveBeenCalled();
});
it('preserves an uncertain decision when commit acknowledgment is lost and never retries',async()=>{
 mock.transaction.mockImplementationOnce(async(work,bounded)=>{await work(mock.query,bounded);throw new Error('Private connection/commit detail');});
 const error=await factory().retire(credential,intent(),signal()).catch(e=>e);expect(error.message).toBe('ORIGINAL_OPERATION_OUTCOME_UNKNOWN');expect(error).not.toHaveProperty('cause');expect(mock.query).toHaveBeenCalledTimes(1);expect([...mock.query.mock.calls[0]![1][0]]).toEqual(Array(32).fill(0));
});
it.each(['during query','after commit'])('retains uncertainty for an abort %s',async stage=>{
 const controller=new AbortController();
 if(stage==='during query')mock.query.mockImplementationOnce(async(_sql,args)=>{controller.abort();return retired({schemaVersion:1,recoveryEpoch:args[8],original:args[9],reason:args[10]});});
 else mock.transaction.mockImplementationOnce(async(work,bounded)=>{const result=await work(mock.query,bounded);controller.abort();return result;});
 await expect(factory().retire(credential,intent(),controller.signal)).rejects.toThrow('ORIGINAL_OPERATION_OUTCOME_UNKNOWN');expect(mock.query).toHaveBeenCalledTimes(1);
});
it('exposes the fixed recovery pause without leaking raw errors or replacing the original epoch',async()=>{
 mock.transaction.mockRejectedValueOnce(new Error('RECOVERY_REVIEW_REQUIRED'));await expect(factory().retire(credential,intent(),signal())).rejects.toThrow('RECOVERY_REVIEW_REQUIRED');expect(mock.query).not.toHaveBeenCalled();
});
it.each(['absent','conflict','original_recorded','retired'])('looks up %s using fresh recent identity and no write transaction',async state=>{
 const request=intent(),value=state==='retired'?retired(request):state==='original_recorded'?{schemaVersion:1,state,original:request.original}:state==='conflict'?{state,reason:'operation'}:{state};mock.read.mockResolvedValueOnce(value);
 const result=await factory().lookup(credential,request.original,signal());expect(result.forServer()).toEqual(value);expect(()=>JSON.stringify(result)).toThrow('ORIGINAL_OPERATION_VALUE_PRIVATE');expect(mock.transaction).not.toHaveBeenCalled();expect(mock.query).not.toHaveBeenCalled();expect(mock.verify.mock.calls[0]!.slice(2)).toEqual(['background',true]);
 const [sql,args]=mock.read.mock.calls[0]!;expect(sql).toBe('SELECT crest_commands.lookup_original_operation_resolution($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::jsonb) AS result');expect(args.slice(7)).toEqual([businessId,request.original]);expect([...args[0]]).toEqual(Array(32).fill(0));
});
it('reads a historical retirement epoch and reason without rebasing it to current authority',async()=>{
 const request=intent(),value=retired(request);value.retirement.recoveryEpoch=randomUUID();value.retirement.reason='Earlier confirmed reason';mock.read.mockResolvedValueOnce(value);expect((await factory().lookup(credential,request.original,signal())).forServer()).toEqual(value);
});
it.each(['foreign original','denied','extra absent','bad conflict','database error','abort'])('fails private lookup on %s without exposing evidence or writing',async issue=>{
 const request=intent(),controller=new AbortController();let value:unknown={state:'absent'};
 if(issue==='foreign original')value={...retired(request),original:original()};if(issue==='denied')value={state:'denied'};if(issue==='extra absent')value={state:'absent',secret:'Private'};if(issue==='bad conflict')value={state:'conflict',reason:'other'};
 if(issue==='database error')mock.read.mockRejectedValueOnce(new Error('Private SQL detail'));else if(issue==='abort')mock.read.mockImplementationOnce(async()=>{controller.abort();return value;});else mock.read.mockResolvedValueOnce(value);
 const error=await factory().lookup(credential,request.original,controller.signal).catch(e=>e);expect(error.message).toBe('ORIGINAL_OPERATION_READ_FAILED');expect(error).not.toHaveProperty('cause');expect(mock.transaction).not.toHaveBeenCalled();expect(mock.query).not.toHaveBeenCalled();expect([...mock.read.mock.calls[0]![1][0]]).toEqual(Array(32).fill(0));
});
it('pins a lookup reference before verification and rejects a draft before verification',async()=>{
 const request=structuredClone(original()),expected=structuredClone(request);mock.verify.mockImplementationOnce(async()=>{Object.assign(request.reference,{operationId:randomUUID()});return verified();});await factory().lookup(credential,request,signal());expect(mock.read.mock.calls[0]![1].slice(7)).toEqual([businessId,expected]);
 vi.clearAllMocks();await expect(factory().lookup(credential,{...original(),draft:'Forbidden'},signal())).rejects.toThrow('ORIGINAL_OPERATION_READ_FAILED');expect(mock.verify).not.toHaveBeenCalled();expect(mock.read).not.toHaveBeenCalled();
});
