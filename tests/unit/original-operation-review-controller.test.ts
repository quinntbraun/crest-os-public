import {randomBytes,randomUUID} from 'node:crypto';
import {afterEach,it,expect,vi} from 'vitest';
import {createOriginalOperationReviewController} from '../../src/client/original-operation-review-controller';
import {originalOperationFixture,retiredOutcomeFixture} from '../support/original-operation-fixture';
import type {Snapshot} from '../../src/client/business-settings';
import type {originalOperations} from '../../src/client/original-operations';
import {pendingCustomerKey} from '../../src/client/pending-customer-edit';

function fixture(){
 const original=originalOperationFixture('crm.customer.save'),binding=randomBytes(32).toString('base64url');
 const record={schemaVersion:1,businessId:original.businessId,binding,reference:original.reference},raw=JSON.stringify(record),memory=new Map([[pendingCustomerKey,raw]]);
 const storage={getItem:vi.fn((key:string)=>memory.get(key)??null),setItem:vi.fn(),removeItem:vi.fn((key:string)=>{memory.delete(key);})};
 let snapshot:Snapshot={context:{schemaVersion:1,businessId:original.businessId,legalName:'Synthetic business',businessVersion:'1',writeState:'ready',recoveryEpoch:randomUUID()},binding};
 const session=vi.fn(async()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000}));
 const settings=vi.fn(async()=>snapshot);
 const api={retire:vi.fn<typeof originalOperations.retire>().mockImplementation(async input=>retiredOutcomeFixture(input as Parameters<typeof retiredOutcomeFixture>[0])),lookup:vi.fn<typeof originalOperations.lookup>().mockResolvedValue({state:'absent'})};
 const resolved=vi.fn(),change=vi.fn(),c=createOriginalOperationReviewController({kind:'crm.customer.save',storage,session,settings,api,resolved,change});
 return {c,original,record,raw,memory,storage,session,settings,api,resolved,change,get snapshot(){return snapshot;},set snapshot(value:Snapshot){snapshot=value;}};
}
async function prepared(){const f=fixture();await f.c.load();f.c.editReason(' Reviewed the lost draft é 😀\nRetire only this save. ');await f.c.review();return f;}
function response(value:unknown){return new Response(JSON.stringify(value),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});}
function receipt(f:ReturnType<typeof fixture>){
 if(f.original.commandType!=='crm.customer.save')throw new Error();
 return {state:'committed',operationId:f.original.reference.operationId,recoveryEpoch:f.original.reference.recoveryEpoch,receipt:{schemaVersion:1,businessId:f.original.businessId,customerId:f.original.reference.customerId,customerVersion:'1',auditEventId:randomUUID()}};
}
afterEach(()=>vi.unstubAllGlobals());
it('loads original metadata after fresh session/context without lookup, mutation, storage writes or draft exposure',async()=>{
 const f=fixture();await f.c.load();expect(f.c.view()).toMatchObject({phase:'review',reference:f.original.reference.operationId,canReview:false,canRetire:false,canLookup:true,reason:''});
 expect(f.session.mock.invocationCallOrder[0]).toBeLessThan(f.settings.mock.invocationCallOrder[0]!);expect(f.api.retire).not.toHaveBeenCalled();expect(f.api.lookup).not.toHaveBeenCalled();expect(f.storage.setItem).not.toHaveBeenCalled();expect(JSON.stringify(f.c.view())).not.toContain('csrfToken');
});
it('requires reason, separate explicit review and confirmation, current proof and unchanged original epoch',async()=>{
 const f=fixture();await f.c.load();await f.c.retire();await f.c.review();expect(f.api.retire).not.toHaveBeenCalled();
 f.c.editReason(' Exact raw reason 😀\r\n ');await f.c.review();expect(f.c.view()).toMatchObject({phase:'confirm',canRetire:true,reason:' Exact raw reason 😀\r\n '});expect(f.api.retire).not.toHaveBeenCalled();
 await f.c.retire();const [input,proof]=f.api.retire.mock.calls[0]!;expect(input).toEqual({schemaVersion:1,original:f.original,recoveryEpoch:f.snapshot.context.recoveryEpoch,reason:' Exact raw reason 😀\r\n '});expect((input as {original:typeof f.original}).original.reference.recoveryEpoch).not.toBe(f.snapshot.context.recoveryEpoch);expect(proof).toEqual(await f.session.mock.results[2]!.value);
 expect(f.c.view()).toMatchObject({phase:'retired',canAcknowledge:true,reason:''});expect(f.memory.get(pendingCustomerKey)).toBe(f.raw);expect(f.resolved).not.toHaveBeenCalled();
 f.c.acknowledge();expect(f.memory.size).toBe(0);expect(f.resolved).toHaveBeenCalledTimes(1);expect(f.c.view().phase).toBe('complete');f.c.acknowledge();expect(f.resolved).toHaveBeenCalledTimes(1);
});
it.each(['','   ','\0','\uD800','x'.repeat(2001)])('does not review an invalid reason',async reason=>{
 const f=fixture();await f.c.load();f.c.editReason(reason);await f.c.review();await f.c.retire();expect(f.c.view().canReview).toBe(false);expect(f.api.retire).not.toHaveBeenCalled();
});
it('back from confirmation requires another review with the edited reason',async()=>{
 const f=await prepared();f.c.editReason('ignored while confirmed');f.c.back();f.c.editReason('replacement reason');await f.c.retire();expect(f.api.retire).not.toHaveBeenCalled();await f.c.review();await f.c.retire();expect(f.api.retire.mock.calls[0]![0]).toMatchObject({reason:'replacement reason'});
});
it.each(['binding','epoch','paused','business'])('does not submit when %s changes after confirmation',async kind=>{
 const f=await prepared(),old=f.snapshot;if(old.context.writeState!=='ready')throw new Error();
 f.snapshot=kind==='binding'?{...old,binding:randomBytes(32).toString('base64url')}:kind==='paused'?{...old,context:{...old.context,writeState:'paused',recoveryEpoch:null}}:{...old,context:{...old.context,...(kind==='epoch'?{recoveryEpoch:randomUUID()}:{businessId:randomUUID()})}};
 await f.c.retire();expect(f.api.retire).not.toHaveBeenCalled();expect(f.c.view()).toMatchObject({phase:'pending',reason:'',canRetire:false});expect(f.memory.get(pendingCustomerKey)).toBe(f.raw);
});
it('requires review again if authority changes while preparing confirmation',async()=>{
 const f=fixture();await f.c.load();f.c.editReason('reason');f.snapshot={...f.snapshot,binding:randomBytes(32).toString('base64url')};await f.c.review();expect(f.c.view().phase).toBe('pending');expect(f.c.view().canRetire).toBe(false);expect(f.api.retire).not.toHaveBeenCalled();
});
it('unknown retirement stays blocked until explicit lookup, without retry or automatic read',async()=>{
 const f=await prepared();f.api.retire.mockRejectedValue(new Error('private server details'));await f.c.retire();await f.c.retire();expect(f.api.retire).toHaveBeenCalledTimes(1);expect(f.api.lookup).not.toHaveBeenCalled();expect(f.c.view()).toMatchObject({phase:'pending',canLookup:true,reason:''});expect(JSON.stringify(f.c.view())).not.toContain('private server');
 const input=f.api.retire.mock.calls[0]![0] as Parameters<typeof retiredOutcomeFixture>[0];f.api.lookup.mockResolvedValue(retiredOutcomeFixture(input));await f.c.lookup();expect(f.api.lookup).toHaveBeenCalledExactlyOnceWith(f.original,expect.any(Object),expect.any(AbortSignal));expect(f.memory.size).toBe(1);f.c.acknowledge();expect(f.resolved).toHaveBeenCalledTimes(1);
});
it.each([{state:'absent' as const},{state:'conflict' as const,reason:'operation' as const}])('never releases an unresolved observation %s',async value=>{
 const f=fixture();await f.c.load();f.api.lookup.mockResolvedValue(value);await f.c.lookup();f.c.acknowledge();await f.c.reconcile();expect(f.memory.get(pendingCustomerKey)).toBe(f.raw);expect(f.resolved).not.toHaveBeenCalled();
});
it('original_recorded requires explicit typed receipt verification rather than a generic observation',async()=>{
 const f=fixture();await f.c.load();f.api.lookup.mockResolvedValue({schemaVersion:1,state:'original_recorded',original:f.original});await f.c.lookup();expect(f.c.view()).toMatchObject({phase:'recorded',canReconcile:true,canAcknowledge:false});expect(f.memory.size).toBe(1);
 const fetcher=vi.fn().mockResolvedValue(response(receipt(f)));vi.stubGlobal('fetch',fetcher);await f.c.reconcile();expect(fetcher.mock.calls[0]![0]).toBe('/api/business/customers/operation');expect(f.memory.size).toBe(0);expect(f.resolved).toHaveBeenCalledTimes(1);expect(f.c.view().phase).toBe('complete');
});
it.each(['absent','wrong-receipt'])('keeps an original-recorded reference on typed %s',async which=>{
 const f=fixture();await f.c.load();f.api.lookup.mockResolvedValue({schemaVersion:1,state:'original_recorded',original:f.original});await f.c.lookup();
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(which==='absent'?{state:'absent'}:{...receipt(f),operationId:randomUUID()})));await f.c.reconcile();expect(f.memory.get(pendingCustomerKey)).toBe(f.raw);expect(f.resolved).not.toHaveBeenCalled();expect(f.c.view().phase).toBe('pending');
});
it('allows explicit historical resolution while current writes are paused, but no retirement',async()=>{
 const f=fixture();f.snapshot={...f.snapshot,context:{...f.snapshot.context,writeState:'paused',recoveryEpoch:null}};await f.c.load();f.c.editReason('reason');await f.c.review();await f.c.retire();expect(f.c.view().canReview).toBe(false);expect(f.api.retire).not.toHaveBeenCalled();await f.c.lookup();expect(f.api.lookup).toHaveBeenCalledTimes(1);expect(f.memory.size).toBe(1);
});
it.each(['confirm','request','lookup'])('hidden-page clearing during %s fences late evidence and preserves the original',async where=>{
 const f=await prepared();let finish!:(value:ReturnType<typeof retiredOutcomeFixture>)=>void;
 let work:Promise<void>|undefined;
 if(where==='request'){f.api.retire.mockImplementation(()=>new Promise(r=>{finish=r;}));work=f.c.retire();await vi.waitFor(()=>expect(f.api.retire).toHaveBeenCalledTimes(1));}
 if(where==='lookup'){f.api.lookup.mockImplementation(()=>new Promise(r=>{finish=r;}));work=f.c.lookup();await vi.waitFor(()=>expect(f.api.lookup).toHaveBeenCalledTimes(1));}
 f.c.suspend();expect(f.c.view()).toMatchObject({phase:'pending',reason:'',reference:'',canLookup:false,canAcknowledge:false,canRetire:false});
 if(work){const input={schemaVersion:1 as const,original:f.original,recoveryEpoch:randomUUID(),reason:'late'};finish(retiredOutcomeFixture(input));await work;}
 expect(f.c.view().canAcknowledge).toBe(false);expect(f.memory.get(pendingCustomerKey)).toBe(f.raw);expect(f.resolved).not.toHaveBeenCalled();
});
it('prevents overlapping retirement, lookup, loading and reason edits',async()=>{
 const f=await prepared();let resolve!:(value:ReturnType<typeof retiredOutcomeFixture>)=>void;f.api.retire.mockImplementation(()=>new Promise(r=>{resolve=r;}));const work=f.c.retire();await vi.waitFor(()=>expect(f.api.retire).toHaveBeenCalledTimes(1));
 await f.c.retire();await f.c.lookup();await f.c.load();f.c.editReason('replacement');expect(f.api.retire).toHaveBeenCalledTimes(1);expect(f.api.lookup).not.toHaveBeenCalled();
 resolve(retiredOutcomeFixture(f.api.retire.mock.calls[0]![0] as Parameters<typeof retiredOutcomeFixture>[0]));await work;
});
it.each(['changed','ignored-removal','throw-removal'])('does not notify the editor until exact storage acknowledgment: %s',async which=>{
 const f=await prepared();await f.c.retire();
 if(which==='changed')f.memory.set(pendingCustomerKey,JSON.stringify({...f.record,binding:randomBytes(32).toString('base64url')}));
 else f.storage.removeItem.mockImplementation(()=>{if(which==='throw-removal')throw new Error('private storage detail');});
 f.c.acknowledge();expect(f.memory.size).toBe(1);expect(f.resolved).not.toHaveBeenCalled();expect(f.c.view().phase).toBe('pending');expect(JSON.stringify(f.c.view())).not.toContain('private storage');
});
it('keeps pending records when authentication cannot be reverified',async()=>{
 const f=await prepared();f.session.mockRejectedValue(new Error('private authentication details'));await f.c.retire();expect(f.api.retire).not.toHaveBeenCalled();expect(f.memory.size).toBe(1);expect(f.c.view().reason).toBe('');
});
it('does not replace a pinned pending record on reload',async()=>{
 const f=fixture();await f.c.load();f.memory.set(pendingCustomerKey,JSON.stringify({...f.record,reference:{...f.original.reference,operationId:randomUUID()}}));await f.c.load();expect(f.c.view().reference).toBe(f.original.reference.operationId);expect(f.c.view().phase).toBe('pending');expect(f.api.retire).not.toHaveBeenCalled();
});
it('disposal aborts a request and ignores its late reply without callbacks or reference removal',async()=>{
 const f=await prepared();let resolve!:(value:ReturnType<typeof retiredOutcomeFixture>)=>void;f.api.retire.mockImplementation(()=>new Promise(r=>{resolve=r;}));const work=f.c.retire();await vi.waitFor(()=>expect(f.api.retire).toHaveBeenCalledTimes(1));f.c.dispose();const count=f.change.mock.calls.length;
 resolve(retiredOutcomeFixture(f.api.retire.mock.calls[0]![0] as Parameters<typeof retiredOutcomeFixture>[0]));await work;expect(f.change).toHaveBeenCalledTimes(count);expect(f.resolved).not.toHaveBeenCalled();expect(f.memory.size).toBe(1);
});
