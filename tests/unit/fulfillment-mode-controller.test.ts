import {it,expect,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {createFulfillmentModeController} from '../../src/client/fulfillment-mode-controller';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../src/client/pending-scheduling';
import {scheduling,SchedulingClientError} from '../../src/client/scheduling';
import {lookupSchedulingOriginal} from '../../src/client/scheduling-original';
import {initialFulfillmentModes} from '../../src/operations/fulfillment-mode-contract';
import {modeHistoryFixture,modeCommitted} from '../fixtures/fulfillment-modes';
function setup(count=1){
 const f=modeHistoryFixture(count),map=new Map<string,string>(),storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}},initializeStore=createPendingSchedulingStore(storage,'operations.fulfillment_modes.initialize'),saveStore=createPendingSchedulingStore(storage,'operations.fulfillment_modes.save'),blocker=createPendingSchedulingStore(storage,'operations.job.book'),proof={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000},context={binding:randomBytes(32).toString('base64url'),context:{schemaVersion:1 as const,businessId:f.businessId,operatorId:f.actor,timezone:'UTC',modeVersion:f.versions.at(-1)??null,writeState:'ready' as const,recoveryEpoch:randomUUID()}};
 const api={...scheduling,workspace:vi.fn(async()=>context),modeHistory:vi.fn<typeof scheduling.modeHistory>().mockImplementation(async(_business,q)=>({schemaVersion:1,businessId:f.businessId,currentSequence:String(count),versions:f.versions.slice(Number(q.afterSequence),Number(q.afterSequence)+q.pageSize),hasMore:Number(q.afterSequence)+q.pageSize<count})),saveModes:vi.fn<typeof scheduling.saveModes>().mockImplementation(async request=>modeCommitted(request))},lookup=vi.fn<typeof lookupSchedulingOriginal>().mockResolvedValue({state:'absent'}),controller=createFulfillmentModeController({initializeStore,saveStore,blockers:[blocker],api,lookup,session:async()=>proof,change:()=>{}}),payload=count?{mobileEnabled:false,dropoffEnabled:true,pickupReturnEnabled:false,reason:'Synthetic owner reviewed mobile availability.'}:{...initialFulfillmentModes};
 return {f,map,storage,initializeStore,saveStore,blocker,api,lookup,controller,context,payload,store:count?saveStore:initializeStore};
}
it.each([0,1])('saves mode sequence %i through its own original-reference kind',async count=>{
 const f=setup(count);await f.controller.load();await f.controller.save(f.payload);expect(f.api.saveModes).toHaveBeenCalledOnce();expect(f.api.saveModes.mock.calls[0]![0]).toMatchObject({expectedSequence:String(count),recoveryEpoch:f.context.context.recoveryEpoch});expect(f.controller.view()).toMatchObject({phase:'committed',savedSequence:String(count+1),context:null,history:[]});expect(f.map.size).toBe(0);f.controller.dispose();
});
it('does not invent default saved history before initialization',async()=>{const f=setup(0);await f.controller.load();expect(f.controller.view()).toMatchObject({phase:'ready',history:[],context:{context:{modeVersion:null}}});expect(f.api.modeHistory).not.toHaveBeenCalled();f.controller.dispose();});
it('rejects reason-only changes and nondefault initialization before mutation',async()=>{
 for(const count of [0,1]){const f=setup(count);await f.controller.load();await f.controller.save(count?{...initialFulfillmentModes,reason:'Reason only.'}:{...f.payload,mobileEnabled:false});expect(f.api.saveModes).not.toHaveBeenCalled();expect(f.controller.view().phase).toBe('ready');expect(f.map.size).toBe(0);f.controller.dispose();}
});
it.each([0,1])('recovers a lost successful mode reply for sequence %i without duplication',async count=>{
 const f=setup(count);f.api.saveModes.mockRejectedValueOnce(new SchedulingClientError('unknown'));await f.controller.load();await f.controller.save(f.payload);const request=f.api.saveModes.mock.calls[0]![0];expect(f.controller.view()).toMatchObject({phase:'pending',history:[],context:null,canRetry:false,pendingKind:count?'operations.fulfillment_modes.save':'operations.fulfillment_modes.initialize'});expect([...f.map.values()].join('')).not.toContain('Synthetic');f.lookup.mockResolvedValueOnce(modeCommitted(request));await f.controller.check();expect(f.controller.view()).toMatchObject({phase:'committed',savedSequence:String(count+1)});expect(f.api.saveModes).toHaveBeenCalledOnce();expect(f.map.size).toBe(0);f.controller.dispose();
});
it('only retries the exact original after an absent-original check',async()=>{
 const f=setup();f.api.saveModes.mockRejectedValueOnce(new SchedulingClientError('unknown'));await f.controller.load();await f.controller.save(f.payload);const original=f.api.saveModes.mock.calls[0]![0];await f.controller.retry();expect(f.api.saveModes).toHaveBeenCalledOnce();await f.controller.check();expect(f.controller.view().canRetry).toBe(true);await f.controller.retry();expect(f.api.saveModes).toHaveBeenCalledTimes(2);expect(f.api.saveModes.mock.calls[1]![0]).toEqual(original);expect(f.lookup).toHaveBeenCalledTimes(2);f.controller.dispose();
});
it('clears private drafts on hide while retaining only the original reference',async()=>{
 const f=setup();f.api.saveModes.mockRejectedValueOnce(new SchedulingClientError('unknown'));await f.controller.load();await f.controller.save(f.payload);f.controller.suspend();await f.controller.load();expect(f.controller.view()).toMatchObject({phase:'pending',canRetry:false,history:[],context:null});await f.controller.retry();expect(f.api.saveModes).toHaveBeenCalledOnce();expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it('preserves server-confirmed status when local reference cleanup fails',async()=>{
 const f=setup();await f.controller.load();f.storage.removeItem=()=>{throw Error();};await f.controller.save(f.payload);expect(f.controller.view()).toMatchObject({phase:'pending',savedSequence:'2',canRetry:false});expect(f.controller.view().message).toContain('server confirmed');expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it('never dispatches a write when opaque storage cannot be verified',async()=>{
 const f=setup();await f.controller.load();f.storage.setItem=()=>{throw Error();};await f.controller.save(f.payload);expect(f.api.saveModes).not.toHaveBeenCalled();expect(f.controller.view()).toMatchObject({phase:'blocked',history:[],context:null});f.controller.dispose();
});
it.each(['binding','mode'] as const)('rejects stale %s before submission',async field=>{
 const f=setup();await f.controller.load();f.api.workspace.mockResolvedValueOnce(field==='binding'?{...f.context,binding:randomBytes(32).toString('base64url')}:{...f.context,context:{...f.context.context,modeVersion:{...f.f.versions[0]!,id:randomUUID()}}});await f.controller.save(f.payload);expect(f.api.saveModes).not.toHaveBeenCalled();expect(f.controller.view()).toMatchObject({phase:'unavailable',history:[],context:null});expect(f.map.size).toBe(0);f.controller.dispose();
});
it('treats review conflict as a known rollback and operation conflict as unresolved',async()=>{
 for(const reason of ['review','operation'] as const){const f=setup();await f.controller.load();f.api.saveModes.mockResolvedValueOnce({state:'conflict',reason});await f.controller.save(f.payload);expect(f.controller.view().phase).toBe(reason==='review'?'review':'pending');expect(f.store.read()===null).toBe(reason==='review');f.controller.dispose();}
});
it.each(['sequence','epoch'] as const)('retains unknown outcome for an unrelated receipt %s',async field=>{
 const f=setup();f.api.saveModes.mockImplementationOnce(async request=>{const saved=modeCommitted(request);return field==='epoch'?{...saved,recoveryEpoch:randomUUID()}:{...saved,receipt:{...saved.receipt,sequence:'99'}};});await f.controller.load();await f.controller.save(f.payload);expect(f.controller.view()).toMatchObject({phase:'pending',savedSequence:'',canRetry:false});expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it('ignores late committed replies after hiding private settings',async()=>{
 const f=setup();let resolve!:(value:Awaited<ReturnType<typeof scheduling.saveModes>>)=>void;f.api.saveModes.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));await f.controller.load();const saving=f.controller.save(f.payload);await vi.waitFor(()=>expect(f.api.saveModes).toHaveBeenCalledOnce());f.controller.suspend();resolve(modeCommitted(f.api.saveModes.mock.calls[0]![0]));await saving;expect(f.controller.view()).toMatchObject({phase:'pending',savedSequence:'',history:[],context:null});expect(f.store.read()).not.toBeNull();f.controller.dispose();
});
it('blocks incompatible interrupted scheduling requests without overwriting them',async()=>{
 const f=setup();f.blocker.write({schemaVersion:1,businessId:f.f.businessId,binding:f.context.binding,reference:{operationId:randomUUID(),recoveryEpoch:f.context.context.recoveryEpoch,jobId:randomUUID(),expectedModeSequence:'1'}});const before=[...f.map];await f.controller.load();expect(f.controller.view().phase).toBe('blocked');expect([...f.map]).toEqual(before);expect(f.api.saveModes).not.toHaveBeenCalled();f.controller.dispose();
});
it('does not guess which of two retained settings operations to erase',async()=>{
 const f=setup(),identity={schemaVersion:1 as const,businessId:f.f.businessId,binding:f.context.binding,reference:{operationId:randomUUID(),recoveryEpoch:f.context.context.recoveryEpoch,expectedSequence:'0'}};f.initializeStore.write(identity);f.saveStore.write({...identity,reference:{...identity.reference,operationId:randomUUID(),expectedSequence:'1'}});await f.controller.load();expect(f.controller.view().phase).toBe('blocked');expect(f.map.has(pendingSchedulingKeys['operations.fulfillment_modes.initialize'])).toBe(true);expect(f.map.size).toBe(2);f.controller.dispose();
});
it('loads consecutive pages and refuses a mixed concurrent history for retrieval',async()=>{
 const f=setup(21);await f.controller.load();expect(f.controller.view()).toMatchObject({phase:'ready',hasMore:true});expect(f.controller.view().history).toHaveLength(20);await f.controller.more();expect(f.controller.view().history).toHaveLength(21);expect(f.controller.view().hasMore).toBe(false);expect(await f.controller.archive()).toBeInstanceOf(Uint8Array);f.api.workspace.mockResolvedValueOnce({...f.context,context:{...f.context.context,modeVersion:{...f.f.versions.at(-1)!,id:randomUUID()}}});expect(await f.controller.archive()).toBeUndefined();expect(f.controller.view()).toMatchObject({phase:'unavailable',history:[]});f.controller.dispose();
});
