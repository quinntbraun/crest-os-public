import {randomBytes,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {openPendingOriginalOperation,PendingOriginalOperationError} from '../../src/client/pending-original-operation';
import {originalOperationKinds} from '../../src/security/original-operation-reference';
import type {OriginalOperationKind} from '../../src/security/original-operation-reference';
import {originalOperationFixture,retirementFixture,retiredOutcomeFixture} from '../support/original-operation-fixture';

// Catalog wire/store connection is deliberately not enabled by this backend
// proposal. Preserve the complete existing eleven-consumer matrix.
const pendingKinds=originalOperationKinds.filter(kind=>kind!=='catalog.service.save');
const keys:Partial<Record<OriginalOperationKind,string>>={
 'business.rename':'crest.business-name.pending.v1',
 'crm.customer.save':'crest.customer.pending-reference.v1',
 'crm.address.save':'crest.address.pending-reference.v1',
 'crm.vehicle.save':'crest.vehicle.pending-reference.v1',
 'crm.vehicle.association':'crest.vehicle-association.pending-reference.v1',
 'crm.lead.source.save':'crest.lead.source.pending-reference.v1',
 'crm.lead.save':'crest.lead.pending-reference.v1',
 'crm.lead.state':'crest.lead-state.pending-reference.v1',
 'crm.lead.vehicle.save':'crest.lead-vehicle.pending-reference.v1',
 'crm.lead.address.save':'crest.lead-address.pending-reference.v1',
 'crm.lead.convert':'crest.lead-conversion.pending-reference.v1'
};
const fetcher=vi.fn(),signal=()=>new AbortController().signal,proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
function response(value:unknown){return new Response(JSON.stringify(value),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});}
function fixture(kind:OriginalOperationKind='crm.customer.save'){
 const original=originalOperationFixture(kind),binding=randomBytes(32).toString('base64url'),key=keys[kind]!;
 const record=kind==='business.rename'?{journalSchema:1,businessId:original.businessId,binding,command:{schemaVersion:1,...original.reference,legalName:'Private synthetic proposed name'}}:{schemaVersion:1,businessId:original.businessId,binding,reference:original.reference};
 const raw=JSON.stringify(record),memory=new Map([[key,raw]]);
 const storage={getItem:vi.fn((key:string)=>memory.get(key)??null),setItem:vi.fn((key:string,value:string)=>{memory.set(key,value);}),removeItem:vi.fn((key:string)=>{memory.delete(key);})};
 const target=openPendingOriginalOperation(kind,storage,original.businessId)!;
 return {kind,original,binding,key,record,raw,memory,storage,target,outcome:retiredOutcomeFixture(retirementFixture(original))};
}
function customerReceipt(f:ReturnType<typeof fixture>){
 if(f.original.commandType!=='crm.customer.save')throw new Error();
 const ref=f.original.reference;
 return {state:'committed',operationId:ref.operationId,recoveryEpoch:ref.recoveryEpoch,receipt:{schemaVersion:1,businessId:f.original.businessId,customerId:ref.customerId,customerVersion:(BigInt(ref.expectedVersion)+1n).toString(),auditEventId:randomUUID()}};
}
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',fetcher);});afterEach(()=>vi.unstubAllGlobals());

it.each(pendingKinds)('opens %s as immutable original metadata without altering storage or exposing drafts',kind=>{
 const f=fixture(kind);expect(f.target.original).toEqual(f.original);expect(f.target.binding).toBe(f.binding);expect(Object.isFrozen(f.target)).toBe(true);expect(Object.isFrozen(f.target.original.reference)).toBe(true);
 expect(JSON.stringify(f.target)).not.toContain('Private synthetic');expect(f.storage.setItem).not.toHaveBeenCalled();expect(f.storage.removeItem).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect(f.memory.get(f.key)).toBe(f.raw);
});
it.each(pendingKinds)('releases only a verified retirement for exactly the retained %s',kind=>{
 const f=fixture(kind);f.target.releaseRetired(f.outcome,signal());expect(f.memory.has(f.key)).toBe(false);expect(f.storage.removeItem).toHaveBeenCalledExactlyOnceWith(f.key);expect(f.storage.setItem).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it.each(pendingKinds)('keeps an absent %s lookup through its existing typed domain transport',async kind=>{
 const f=fixture(kind);fetcher.mockResolvedValue(response({state:'absent'}));expect(await f.target.reconcile(proof(),signal())).toBe('absent');expect(f.memory.get(f.key)).toBe(f.raw);expect(f.storage.removeItem).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({operationId:f.original.reference.operationId});
});
it.each(pendingKinds)('rejects replacement storage for %s before retirement acknowledgment',kind=>{
 const f=fixture(kind);f.memory.set(f.key,JSON.stringify({...f.record,binding:randomBytes(32).toString('base64url')}));expect(()=>f.target.releaseRetired(f.outcome,signal())).toThrow(PendingOriginalOperationError);expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it.each(pendingKinds)('fails closed on unreadable pending %s and another business',kind=>{
 const f=fixture(kind);expect(()=>openPendingOriginalOperation(kind,f.storage,randomUUID())).toThrow(PendingOriginalOperationError);f.memory.set(f.key,'{');expect(()=>openPendingOriginalOperation(kind,f.storage,f.original.businessId)).toThrow(PendingOriginalOperationError);expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it.each(pendingKinds)('returns no target for missing %s without a replacement identity',kind=>{
 const storage={getItem:vi.fn(()=>null),setItem:vi.fn(),removeItem:vi.fn()};expect(openPendingOriginalOperation(kind,storage,randomUUID())).toBeNull();expect(storage.setItem).not.toHaveBeenCalled();expect(storage.removeItem).not.toHaveBeenCalled();
});
it.each([{state:'absent'},{state:'conflict',reason:'operation'},'original_recorded','wrong-original','wrong-receipt','extra'])('never clears from an insufficient retirement observation %s',input=>{
 const f=fixture();const value=input==='original_recorded'?{schemaVersion:1,state:input,original:f.original}:input==='wrong-original'?{...f.outcome,original:originalOperationFixture()}:input==='wrong-receipt'?{...f.outcome,retirement:{...f.outcome.retirement,auditEventId:'invalid'}}:input==='extra'?{...f.outcome,extra:'untrusted'}:input;
 expect(()=>f.target.releaseRetired(value,signal())).toThrow(PendingOriginalOperationError);expect(f.memory.get(f.key)).toBe(f.raw);expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it('confirms an original customer through its full typed receipt before clearing',async()=>{
 const f=fixture();fetcher.mockResolvedValue(response(customerReceipt(f)));expect(await f.target.reconcile(proof(),signal())).toBe('committed');expect(f.memory.has(f.key)).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['business','operation','epoch','customer','version','original_recorded'])('retains the original on an invalid typed customer receipt: %s',async which=>{
 const f=fixture(),value=customerReceipt(f);if(which==='business')value.receipt.businessId=randomUUID();if(which==='operation')value.operationId=randomUUID();if(which==='epoch')value.recoveryEpoch=randomUUID();if(which==='customer')value.receipt.customerId=randomUUID();if(which==='version')value.receipt.customerVersion='9223372036854775807';
 fetcher.mockResolvedValue(response(which==='original_recorded'?{schemaVersion:1,state:'original_recorded',original:f.original}:value));
 await expect(f.target.reconcile(proof(),signal())).rejects.toThrow(PendingOriginalOperationError);expect(f.memory.get(f.key)).toBe(f.raw);expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it('does not dispatch or clear after cancellation',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await expect(f.target.reconcile(proof(),controller.signal)).rejects.toThrow(PendingOriginalOperationError);expect(()=>f.target.releaseRetired(f.outcome,controller.signal)).toThrow(PendingOriginalOperationError);expect(fetcher).not.toHaveBeenCalled();expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it.each(['abort','replace'])('fences a late valid original receipt after %s',async which=>{
 const f=fixture(),controller=new AbortController();let resolve!:(value:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(r=>{resolve=r;}));const pending=f.target.reconcile(proof(),controller.signal);
 if(which==='abort')controller.abort();else f.memory.set(f.key,JSON.stringify({...f.record,binding:randomBytes(32).toString('base64url')}));
 resolve(response(customerReceipt(f)));await expect(pending).rejects.toThrow(PendingOriginalOperationError);expect(f.memory.has(f.key)).toBe(true);expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it.each(['ignored','throw','replacement'])('requires an acknowledged exact removal when storage %s',which=>{
 const f=fixture();f.storage.removeItem.mockImplementation(()=>{if(which==='throw')throw new Error('private browser data');if(which==='replacement')f.memory.set(f.key,JSON.stringify({...f.record,binding:randomBytes(32).toString('base64url')}));});
 expect(()=>f.target.releaseRetired(f.outcome,signal())).toThrow('PENDING_ORIGINAL_OPERATION_REVIEW_REQUIRED');expect(f.memory.has(f.key)).toBe(true);
});
it('blocks a changed intent before original receipt lookup and never sends its replacement',async()=>{
 const f=fixture();f.memory.delete(f.key);await expect(f.target.reconcile(proof(),signal())).rejects.toThrow(PendingOriginalOperationError);expect(fetcher).not.toHaveBeenCalled();
});
it('fails closed for unsupported runtime command kinds',()=>{
 const f=fixture();expect(()=>openPendingOriginalOperation('financial.post' as OriginalOperationKind,f.storage,f.original.businessId)).toThrow(PendingOriginalOperationError);expect(f.storage.removeItem).not.toHaveBeenCalled();
});

it('does not expose catalog pending storage before its actual transport/store connection',()=>{const storage={getItem:vi.fn(()=>null),setItem:vi.fn(),removeItem:vi.fn()};expect(()=>openPendingOriginalOperation('catalog.service.save',storage,randomUUID())).toThrow(PendingOriginalOperationError);expect(storage.getItem).not.toHaveBeenCalled();expect(storage.removeItem).not.toHaveBeenCalled();});
