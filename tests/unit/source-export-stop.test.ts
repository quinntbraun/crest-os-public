import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {sourceExportStopFixture} from '../support/source-export-stop-fixture';
import {parseSourceExportStopWire,sourceExportStopToWire,parseSourceExportStopOutcome} from '../../src/security/source-export-stop-contract';
import {createPendingExportStopStore} from '../../src/client/pending-export-stop';
import {createSourceExportStopController} from '../../src/client/source-export-stop-controller';
import {AuthenticationError} from '../../src/client/authentication';
import {SourceExportClientError} from '../../src/client/source-exports';
const signal=()=>new AbortController().signal;
function fixture(){
 const f=sourceExportStopFixture(),values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}},store=createPendingExportStopStore(storage,f.businessId,f.actorId,f.job.id);
 const api={status:vi.fn(async()=>({state:'found' as const,job:f.job})),stop:vi.fn(async(cmd:unknown)=>f.stopped(cmd as typeof f.command)),lookup:vi.fn(async()=>({state:'absent' as const}))};
 const session=vi.fn(async()=>({csrfToken:'proof',expiresAt:Date.now()+60000})),context=vi.fn(async()=>f.context),onResolved=vi.fn(),onAccessDenied=vi.fn(),id=vi.fn(()=>f.command.reference.operationId);
 const c=createSourceExportStopController({jobId:f.job.id,storage,change:vi.fn(),session,context,api:()=>api,id,onResolved,onAccessDenied});return{...f,contextValue:f.context,values,storage,store,api,session,context,onResolved,onAccessDenied,id,c};
}
it('accepts the closed stop wire and rejects duplicate and foreign-scope fields',()=>{
 const f=fixture(),wire=sourceExportStopToWire(f.command);expect(parseSourceExportStopWire(wire,f.businessId)).toEqual(f.command);
 expect(()=>parseSourceExportStopWire({originalJson:wire.originalJson.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1')},f.businessId)).toThrow();
 expect(()=>parseSourceExportStopWire(wire,randomUUID())).toThrow();expect(()=>parseSourceExportStopWire({...wire,extra:true},f.businessId)).toThrow();
 expect(()=>parseSourceExportStopOutcome({state:'absent'},f.command,f.actorId)).toThrow();expect(parseSourceExportStopOutcome({state:'absent'},f.command,f.actorId,true)).toEqual({state:'absent'});
 expect(()=>parseSourceExportStopOutcome({state:'conflict',reason:'version'},f.command,f.actorId,true)).toThrow();
});
it('persists before dispatch, commits only the exact receipt and refreshes parent history',async()=>{
 const f=fixture();f.api.stop.mockImplementationOnce(async cmd=>{expect(f.store.read()?.command).toEqual(cmd);return f.stopped(cmd as typeof f.command);});await f.c.load();expect(f.c.view().canStop).toBe(true);await f.c.stop();
 expect(f.c.view()).toMatchObject({phase:'stopped',canStop:false,canRetry:false,reference:''});expect(f.store.read()).toBeNull();expect(f.onResolved).toHaveBeenCalledOnce();expect(f.api.stop).toHaveBeenCalledOnce();
});
it('retains a lost acknowledgment and retries the same operation only after an explicit absent check',async()=>{
 const f=fixture();await f.c.load();f.api.stop.mockRejectedValueOnce(Error('lost acknowledgment'));await f.c.stop();const saved=f.store.read();expect(saved).not.toBeNull();expect(f.c.view()).toMatchObject({phase:'pending',canRetry:false});await f.c.retry();expect(f.api.stop).toHaveBeenCalledOnce();
 await f.c.check();expect(f.store.read()).toEqual(saved);expect(f.c.view().canRetry).toBe(true);await f.c.retry();expect(f.api.stop.mock.calls[1]![0]).toEqual(saved!.command);expect(f.id).toHaveBeenCalledOnce();expect(f.store.read()).toBeNull();
});
it('settles a lost acknowledgment from the exact original receipt without another stop',async()=>{
 const f=fixture();f.store.record(f.command);await f.c.load();f.api.lookup.mockResolvedValueOnce(f.stopped() as never);await f.c.check();expect(f.store.read()).toBeNull();expect(f.c.view().phase).toBe('stopped');expect(f.api.stop).not.toHaveBeenCalled();expect(f.onResolved).toHaveBeenCalledOnce();
});
it('does not settle an acknowledgment arriving after the tab has hidden',async()=>{
 const f=fixture();let resolve:(value:ReturnType<typeof f.stopped>)=>void=()=>{};await f.c.load();f.api.stop.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const work=f.c.stop();await vi.waitFor(()=>expect(f.api.stop).toHaveBeenCalledOnce());const saved=f.store.read();f.c.reviewOnReturn();resolve(f.stopped());await work;expect(f.store.read()).toEqual(saved);expect(f.c.view()).toMatchObject({phase:'review',reference:'',state:''});expect(f.onResolved).not.toHaveBeenCalled();
});
it('requires an explicit new stop after a stale version conflict',async()=>{
 const f=fixture();await f.c.load();f.api.stop.mockResolvedValueOnce({state:'conflict',reason:'version'} as never);f.api.status.mockResolvedValueOnce({state:'found',job:f.job}).mockResolvedValueOnce({state:'found',job:f.running});await f.c.stop();expect(f.api.stop).toHaveBeenCalledOnce();expect(f.store.read()).toBeNull();expect(f.c.view()).toMatchObject({phase:'ready',state:'Running',canStop:true});
});
it('closes a saved stop after fresh worker progress without stopping the newer version automatically',async()=>{
 const f=fixture();f.store.record(f.command);await f.c.load();f.api.status.mockResolvedValueOnce({state:'found',job:f.running});await f.c.check();expect(f.store.read()).toBeNull();expect(f.c.view()).toMatchObject({phase:'ready',state:'Running',canStop:true});expect(f.api.stop).not.toHaveBeenCalled();expect(f.onResolved).toHaveBeenCalledOnce();
});
it('uses the latest recovery state when an absent check cannot fence the saved operation',async()=>{
 const f=fixture();f.store.record(f.command);await f.c.load();f.context.mockResolvedValueOnce(f.contextValue).mockResolvedValueOnce({...f.contextValue,writeState:'paused',recoveryEpoch:null} as never);await f.c.check();expect(f.store.read()).not.toBeNull();expect(f.c.view().canRetry).toBe(false);expect(f.c.view().message).toContain('when access and writes are available');expect(f.api.stop).not.toHaveBeenCalled();
});
it('refuses a changed actor before sending a stop and hides private state',async()=>{
 const f=fixture();await f.c.load();f.context.mockResolvedValueOnce({...f.contextValue,actorId:randomUUID()});await f.c.stop();expect(f.api.stop).not.toHaveBeenCalled();expect(f.c.view()).toMatchObject({phase:'review',state:'',reference:''});expect(f.onAccessDenied).toHaveBeenCalledOnce();
});
it('keeps the persisted reference through denied access and tab return',async()=>{
 const f=fixture();f.store.record(f.command);await f.c.load();f.session.mockRejectedValueOnce(new AuthenticationError('denied'));await f.c.check();expect(f.store.read()).not.toBeNull();expect(f.c.view()).toMatchObject({phase:'review',reference:'',state:''});await f.c.load();f.c.reviewOnReturn();expect(f.c.view()).toMatchObject({phase:'review',reference:'',state:''});expect(f.store.read()).not.toBeNull();
});
it('does not dispatch when reference persistence fails and preserves cross-tab replacement',async()=>{
 const f=fixture();f.storage.setItem=()=>{throw Error('storage unavailable');};await f.c.load();await f.c.stop();expect(f.api.stop).not.toHaveBeenCalled();expect(f.c.view().phase).toBe('blocked');
 const g=fixture(),saved=g.store.record(g.command),key=[...g.values.keys()][0]!;g.values.set(key,saved.binding.replace(g.command.reference.operationId,randomUUID()));expect(()=>g.store.releaseCommitted(saved,g.stopped(),signal())).toThrow();expect(g.values.has(key)).toBe(true);
});
it('does not clear on absence, a foreign receipt, unchanged version or cancellation',()=>{
 const f=fixture(),p=f.store.record(f.command);expect(()=>f.store.releaseCommitted(p,{state:'absent'},signal())).toThrow();expect(()=>f.store.releaseCommitted(p,{...f.stopped(),operationId:randomUUID()},signal())).toThrow();expect(()=>f.store.releaseFenced(p,f.job,null,signal())).toThrow();
 const c=new AbortController();c.abort();expect(()=>f.store.releaseCommitted(p,f.stopped(),c.signal)).toThrow();expect(f.store.read()).toEqual(p);
});
it('separates references by actor/job and only releases on a newer version or changed active epoch',()=>{
 const f=fixture(),p=f.store.record(f.command);expect(createPendingExportStopStore(f.storage,f.businessId,randomUUID(),f.job.id).read()).toBeNull();expect(createPendingExportStopStore(f.storage,f.businessId,f.actorId,randomUUID()).read()).toBeNull();f.store.releaseFenced(p,f.job,randomUUID(),signal());expect(f.store.read()).toBeNull();
});
it('allows an explicitly not-submitted stop to retry its saved operation without generating a new ID',async()=>{
 const f=fixture();await f.c.load();f.api.stop.mockRejectedValueOnce(new SourceExportClientError('not_submitted'));await f.c.stop();expect(f.c.view().canRetry).toBe(true);await f.c.retry();expect(f.api.stop.mock.calls.map(call=>call[0])).toEqual([f.command,f.command]);expect(f.id).toHaveBeenCalledOnce();
});
