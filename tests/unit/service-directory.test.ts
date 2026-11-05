import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({verify:vi.fn(),read:vi.fn(),query:vi.fn(),transaction:vi.fn(),events:[] as string[]}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>Object.assign(mock.read,{commandTransaction:mock.transaction})}));
vi.mock('../../src/security/session-lifecycle.ts',()=>({createSessionLifecycle:()=>({verify:mock.verify})}));
import {createServiceDirectory,ServiceDirectoryError} from '../../src/commercial/service-directory.ts';
import {serviceStorageFixture} from '../support/service-storage-fixture.ts';
const f=serviceStorageFixture(),credential=randomBytes(32).toString('base64url');
const signal=()=>new AbortController().signal;
const proof=()=>({sessionId:randomUUID(),actorId:f.actor,provider:{issuer:'https://auth.example.com/auth/v1',subject:randomUUID(),sessionId:randomUUID(),expiresAt:Date.now()+60000}});
const factory=()=>createServiceDirectory({connectionString:'unused-by-mock',environment:'test'},{} as Parameters<typeof createServiceDirectory>[1],{} as Parameters<typeof createServiceDirectory>[2]);
beforeEach(()=>{vi.clearAllMocks();mock.events.length=0;mock.verify.mockImplementation(async()=>{mock.events.push('verify');return proof();});mock.query.mockImplementation(async()=>{mock.events.push('query');return f.committed;});mock.read.mockResolvedValue(f.committed);mock.transaction.mockImplementation(async(work,currentSignal)=>{mock.events.push('begin');const result=await work(mock.query,currentSignal);mock.events.push('commit');return result;});});
it('verifies in background, binds fixed SQL and returns private immutable evidence after commit',async()=>{
 const result=await factory().save(credential,f.request,signal());expect(result.forServer()).toEqual(f.committed);expect(mock.events).toEqual(['verify','begin','query','commit']);expect(()=>JSON.stringify(result)).toThrow('SERVICE_VALUE_PRIVATE');expect(Object.isFrozen(result.forServer())).toBe(true);
 const [sql,args]=mock.query.mock.calls[0]!;expect(sql).toContain('crest_commands.save_service');expect(args.slice(7)).toEqual([f.business,f.epoch,f.operation,1,f.service.id,'0',f.request.payload]);expect(mock.verify).toHaveBeenCalledWith(credential,expect.any(AbortSignal),'background');
});
it('withholds a provisional receipt until commit acknowledgment',async()=>{
 let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});const commit=new Promise<void>(resolve=>{release=resolve;});
 mock.transaction.mockImplementation(async(work,s)=>{const result=await work(mock.query,s);entered();await commit;return result;});
 let returned=false;const pending=factory().save(credential,f.request,signal()).then(value=>{returned=true;return value;});await ready;expect(returned).toBe(false);release();expect((await pending).forServer()).toEqual(f.committed);
});
it('a lost COMMIT reply remains unknown with one submission and no automatic retry',async()=>{
 mock.transaction.mockImplementation(async(work,s)=>{await work(mock.query,s);throw new Error('private commit transport detail');});await expect(factory().save(credential,f.request,signal())).rejects.toThrow('SERVICE_SAVE_OUTCOME_UNKNOWN');expect(mock.query).toHaveBeenCalledTimes(1);expect(mock.read).not.toHaveBeenCalled();
});
it('connection refusal before the save callback is not submitted',async()=>{mock.transaction.mockRejectedValue(new Error('private connection detail'));await expect(factory().save(credential,f.request,signal())).rejects.toThrow('SERVICE_SAVE_NOT_SUBMITTED');expect(mock.query).not.toHaveBeenCalled();});
it.each([{state:'conflict',reason:'operation'},{state:'conflict',reason:'service'},{state:'conflict',reason:'code'},{state:'conflict',reason:'version',currentRevision:'9007199254740993'}])('retains safe conflict %j',async result=>{mock.query.mockResolvedValue(result);expect((await factory().save(credential,f.request,signal())).forServer()).toEqual(result);});
it('returns unchanged without inventing a receipt, and explicit denial only after commit',async()=>{
 const input={...f.request,expectedRevision:'1'},unchanged={state:'unchanged',serviceId:f.service.id,currentRevision:'1'};mock.query.mockResolvedValueOnce(unchanged);expect((await factory().save(credential,input,signal())).forServer()).toEqual(unchanged);
 mock.query.mockResolvedValueOnce({state:'denied'});await expect(factory().save(credential,input,signal())).rejects.toThrow('SERVICE_SAVE_DENIED');expect(mock.events.at(-1)).toBe('commit');
});
it.each([null,{}, {...f.committed,extra:true},{...f.committed,operationId:randomUUID()},{...f.committed,recoveryEpoch:randomUUID()},{...f.committed,receipt:{...f.receipt,serviceId:randomUUID()}},{...f.committed,receipt:{...f.receipt,serviceRevision:'2',contentSequence:'2'}},{state:'unchanged',serviceId:f.service.id,currentRevision:'0'},{state:'conflict',reason:'private value'},{state:'conflict',reason:'version',currentRevision:'1\n'}])('malformed submitted results remain unknown %j',async value=>{mock.query.mockResolvedValue(value);await expect(factory().save(credential,f.request,signal())).rejects.toThrow('SERVICE_SAVE_OUTCOME_UNKNOWN');expect(mock.query).toHaveBeenCalledTimes(1);});
it('preserves bigint root revision arithmetic without numeric conversion',async()=>{
 const request={...f.request,expectedRevision:'9007199254740993'},result={...f.committed,receipt:{...f.receipt,serviceRevision:'9007199254740994',contentSequence:'2'}};mock.query.mockResolvedValue(result);expect((await factory().save(credential,request,signal())).forServer()).toEqual(result);
});
it('seals identifiers, payload and nested definition before asynchronous verification',async()=>{
 let release!:(v:ReturnType<typeof proof>)=>void;mock.verify.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const request=structuredClone(f.request),pending=factory().save(credential,request,signal());Object.assign(request,{serviceId:randomUUID(),operationId:randomUUID(),recoveryEpoch:randomUUID()});Object.assign(request.payload.definition,{name:'Mutated'});release(proof());await pending;const args=mock.query.mock.calls[0]![1];expect(args[9]).toBe(f.operation);expect(args[11]).toBe(f.service.id);expect(args[13].definition.name).toBe(f.content.name);
});
it('sanitizes provider/database failures and preserves only the fixed recovery marker',async()=>{
 mock.verify.mockRejectedValueOnce(new Error('private provider detail'));await expect(factory().save(credential,f.request,signal())).rejects.toThrow('SERVICE_SAVE_NOT_SUBMITTED');mock.query.mockRejectedValueOnce(new Error('private database detail'));await expect(factory().save(credential,f.request,signal())).rejects.toThrow('SERVICE_SAVE_OUTCOME_UNKNOWN');mock.query.mockRejectedValueOnce(new Error('RECOVERY_REVIEW_REQUIRED'));await expect(factory().save(credential,f.request,signal())).rejects.toThrow('RECOVERY_REVIEW_REQUIRED');
});
it('invalid inputs and cancelled requests perform no provider or database work',async()=>{
 for(const input of [{...f.request,expectedRevision:1},{...f.request,serviceId:f.service.id+'\n'},{...f.request,payload:{...f.request.payload,extra:true}}])await expect(factory().save(credential,input as never,signal())).rejects.toThrow('SERVICE_SAVE_NOT_SUBMITTED');
 const abort=new AbortController();abort.abort();await expect(factory().save(credential,f.request,abort.signal)).rejects.toThrow('SERVICE_SAVE_NOT_SUBMITTED');expect(mock.verify).not.toHaveBeenCalled();expect(mock.transaction).not.toHaveBeenCalled();
});
it('zeros credential hash memory after database completion',async()=>{mock.query.mockImplementation(async(_sql,args)=>{expect(Buffer.from(args[0])).toEqual(createHash('sha256').update(credential,'ascii').digest());return f.committed;});await factory().save(credential,f.request,signal());expect([...mock.query.mock.calls[0]![1][0]]).toEqual(Array(32).fill(0));});
it('lookup preserves original epochs and absence without submitting a save',async()=>{
 expect((await factory().lookup(credential,{businessId:f.business,operationId:f.operation},signal())).forServer()).toEqual(f.committed);mock.read.mockResolvedValueOnce({state:'absent'});expect((await factory().lookup(credential,{businessId:f.business,operationId:f.operation},signal())).forServer()).toEqual({state:'absent'});expect(mock.transaction).not.toHaveBeenCalled();
});
it('private current directory and history use the validated data boundary',async()=>{
 mock.read.mockResolvedValueOnce(f.directory);expect((await factory().list(credential,f.listRequest,signal())).forServer()).toEqual(f.directory);
 mock.read.mockResolvedValueOnce(f.history);expect((await factory().history(credential,f.historyRequest,signal())).forServer()).toEqual(f.history);expect(mock.transaction).not.toHaveBeenCalled();
 mock.read.mockResolvedValueOnce({...f.history,history:[]});await expect(factory().history(credential,f.historyRequest,signal())).rejects.toThrow('SERVICE_REQUEST_FAILED');
});
it('rejects invalid read cursors and page bounds before authorization',async()=>{
 await expect(factory().list(credential,{...f.listRequest,pageSize:51},signal())).rejects.toBeInstanceOf(ServiceDirectoryError);await expect(factory().history(credential,{...f.historyRequest,afterRevision:'1\n'},signal())).rejects.toThrow('SERVICE_REQUEST_FAILED');expect(mock.verify).not.toHaveBeenCalled();
});
