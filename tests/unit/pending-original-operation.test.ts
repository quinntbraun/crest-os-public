import {randomBytes,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {openPendingOriginalOperation,PendingOriginalOperationError} from '../../src/client/pending-original-operation';
import {originalOperationKinds} from '../../src/security/original-operation-reference';
import type {OriginalOperationKind} from '../../src/security/original-operation-reference';
import {originalOperationFixture,retirementFixture,retiredOutcomeFixture} from '../support/original-operation-fixture';

// Every connected pending transport, including candidate catalog construction.
// Runtime exposure still requires catalog migration/source/recovery adoption.
const pendingKinds=originalOperationKinds;
const keys:Record<OriginalOperationKind,string>={
 'bookkeeping.expense.save':'crest.expense.pending-reference.v1',
 'bookkeeping.receipt.reserve':'crest.receipt.pending-reference.v1',
 'bookkeeping.receipt.publish':'crest.receipt.pending-reference.v1',
 'operations.appointment_hold.save':'crest.appointment-hold.pending-reference.v1',
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
 'crm.lead.convert':'crest.lead-conversion.pending-reference.v1',
 'catalog.service.save':'crest.service.pending-reference.v1',
 'quote.draft.save':'crest.quote.pending-reference.v1',
 'quote.replacement.create':'crest.quote-replacement.pending-reference.v1',
 'quote.manual.send':'crest.quote-commercial.pending-reference.v1',
 'quote.confirmation.accept':'crest.quote-commercial.pending-reference.v1',
 'quote.review.submit':'crest.quote-review.pending-reference.v1',
 'quote.review.approve':'crest.quote-review.pending-reference.v1'
};
const fetcher=vi.fn(),signal=()=>new AbortController().signal,proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
function response(value:unknown){return new Response(JSON.stringify(value),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});}
function contextResponse(businessId:string,binding=randomBytes(32).toString('base64url')){return new Response(JSON.stringify({businessId,recoveryEpoch:null,writeState:'paused'}),{headers:{'content-type':'application/json','cache-control':'private, no-store','x-crest-edit-binding':binding}});}
function fixture(kind:OriginalOperationKind='crm.customer.save'){
 const original=originalOperationFixture(kind),binding=randomBytes(32).toString('base64url'),key=keys[kind]!;
 const reference=original.commandType==='quote.review.submit'||original.commandType==='quote.review.approve'?{...original.reference,action:original.commandType==='quote.review.submit'?'submit':'approve',approvalId:original.commandType==='quote.review.approve'?original.reference.approvalId:null}:original.commandType==='quote.manual.send'||original.commandType==='quote.confirmation.accept'?{...original.reference,action:original.commandType==='quote.manual.send'?'send':'accept'}:original.reference;
 const record=kind==='business.rename'?{journalSchema:1,businessId:original.businessId,binding,command:{schemaVersion:1,...original.reference,legalName:'Private synthetic proposed name'}}:{schemaVersion:1,businessId:original.businessId,binding,reference};
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
 const f=fixture(kind),financial=kind.startsWith('bookkeeping.'),freshBinding=randomBytes(32).toString('base64url');
 if(financial)fetcher.mockResolvedValueOnce(contextResponse(f.original.businessId,freshBinding));
 fetcher.mockResolvedValue(response({state:'absent'}));expect(await f.target.reconcile(proof(),signal())).toBe('absent');expect(f.memory.get(f.key)).toBe(f.raw);expect(f.storage.removeItem).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(financial?2:1);
 const request=fetcher.mock.calls.at(-1)![1];expect(JSON.parse(request.body)).toEqual(financial?f.original.reference:{operationId:f.original.reference.operationId});if(financial)expect(request.headers['x-crest-edit-binding']).toBe(freshBinding);
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

it('clears a catalog original only after its exact typed retained receipt',async()=>{
 const f=fixture('catalog.service.save');if(f.original.commandType!=='catalog.service.save')throw new Error();
 const ref=f.original.reference,value={state:'committed',operationId:ref.operationId,recoveryEpoch:ref.recoveryEpoch,receipt:{schemaVersion:1,businessId:f.original.businessId,serviceId:ref.serviceId,serviceRevision:(BigInt(ref.expectedRevision)+1n).toString(),contentVersionId:randomUUID(),contentSequence:'1',auditEventId:randomUUID(),contentAuditEventId:randomUUID()}};
 fetcher.mockResolvedValue(response(value));expect(await f.target.reconcile(proof(),signal())).toBe('committed');expect(f.memory.has(f.key)).toBe(false);expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/business/services/operation',expect.any(Object));
});
it.each(['recorded','service','epoch','revision','abort','replace'])('retains the catalog original on insufficient or late evidence: %s',async which=>{
 const f=fixture('catalog.service.save');if(f.original.commandType!=='catalog.service.save')throw new Error();
 const ref=f.original.reference,value={state:'committed',operationId:ref.operationId,recoveryEpoch:ref.recoveryEpoch,receipt:{schemaVersion:1,businessId:f.original.businessId,serviceId:ref.serviceId,serviceRevision:'1',contentVersionId:randomUUID(),contentSequence:'1',auditEventId:randomUUID(),contentAuditEventId:randomUUID()}};
 if(which==='service')value.receipt.serviceId=randomUUID();if(which==='epoch')value.recoveryEpoch=randomUUID();if(which==='revision')value.receipt.serviceRevision='2';
 const controller=new AbortController();let resolve!:(v:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(r=>{resolve=r;}));const pending=f.target.reconcile(proof(),controller.signal);
 if(which==='abort')controller.abort();if(which==='replace')f.memory.set(f.key,JSON.stringify({...f.record,binding:randomBytes(32).toString('base64url')}));
 resolve(response(which==='recorded'?{schemaVersion:1,state:'original_recorded',original:f.original}:value));await expect(pending).rejects.toThrow(PendingOriginalOperationError);expect(f.memory.has(f.key)).toBe(true);expect(f.storage.removeItem).not.toHaveBeenCalled();
});

const financialKinds=['bookkeeping.expense.save','bookkeeping.receipt.reserve','bookkeeping.receipt.publish'] as const;
function financialReceipt(f:ReturnType<typeof fixture>){
 const original=f.original;if(original.commandType==='bookkeeping.expense.save')return {state:'committed',expense:{businessId:original.businessId,expenseId:original.reference.expenseId,revision:'1',operationId:original.reference.operationId,actorId:randomUUID(),recordedAt:'2026-10-29T08:00:00.123456Z',payload:{paidOn:'2026-10-29',amountCents:'1500',currency:'USD',category:'supplies',description:'Synthetic towels',vendor:null,paymentMethod:'cash',reference:null,notes:null,voided:false,changeReason:null}}};
 if(original.commandType!=='bookkeeping.receipt.reserve'&&original.commandType!=='bookkeeping.receipt.publish')throw Error();
 const r=original.reference,published=r.expectedRevision==='1';return {state:'committed',original:r,receipt:{receiptId:r.receiptId,expenseId:r.expenseId,expenseRevision:r.expenseRevision,receiptVersion:published?'2':'1',status:published?'available':'reserved',declaredType:'image/png',byteSize:100,sourceSha256:published?'a'.repeat(64):null}};
}
it.each(financialKinds)('reconciles %s through fresh financial context after a changed sign-in binding',async kind=>{
 const f=fixture(kind),binding=randomBytes(32).toString('base64url');fetcher.mockResolvedValueOnce(contextResponse(f.original.businessId,binding)).mockResolvedValueOnce(response(financialReceipt(f)));
 expect(await f.target.reconcile(proof(),signal())).toBe('committed');expect(f.memory.has(f.key)).toBe(false);expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/api/business/expenses/context',kind==='bookkeeping.expense.save'?'/api/business/expenses/operation':'/api/business/expense-receipts/operation']);expect(fetcher.mock.calls[1]![1].headers['x-crest-edit-binding']).toBe(binding);expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(f.original.reference);
});
it.each(financialKinds.flatMap(kind=>['recorded','wrong-target','wrong-business','abort','replace'].map(fault=>({kind,fault}))))('keeps financial reference on insufficient or late evidence: $kind / $fault',async({kind,fault})=>{
 const f=fixture(kind),controller=new AbortController();let resolve!:(value:Response)=>void;
 fetcher.mockResolvedValueOnce(contextResponse(fault==='wrong-business'?randomUUID():f.original.businessId)).mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r;}));
 const pending=f.target.reconcile(proof(),controller.signal);
 if(fault==='wrong-business'){await expect(pending).rejects.toThrow(PendingOriginalOperationError);expect(fetcher).toHaveBeenCalledTimes(1);}else{
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
  if(fault==='abort')controller.abort();if(fault==='replace')f.memory.set(f.key,JSON.stringify({...f.record,binding:randomBytes(32).toString('base64url')}));
  const value=financialReceipt(f);if(fault==='wrong-target'){if('expense' in value)value.expense!.expenseId=randomUUID();else value.receipt!.receiptId=randomUUID();}
  resolve(response(fault==='recorded'?{schemaVersion:1,state:'original_recorded',original:f.original}:value));await expect(pending).rejects.toThrow(PendingOriginalOperationError);
 }
 expect(f.memory.has(f.key)).toBe(true);expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it.each(['bookkeeping.receipt.reserve','bookkeeping.receipt.publish'] as const)('does not interpret the other receipt stage as %s',kind=>{const f=fixture(kind);expect(openPendingOriginalOperation(kind==='bookkeeping.receipt.reserve'?'bookkeeping.receipt.publish':'bookkeeping.receipt.reserve',f.storage,f.original.businessId)).toBeNull();expect(f.memory.get(f.key)).toBe(f.raw);});
