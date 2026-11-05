import {randomBytes,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {createPendingQuoteAmendmentStore,pendingQuoteAmendmentKeys} from '../../src/client/pending-quote-amendment';
import {openPendingOriginalOperation,PendingOriginalOperationError} from '../../src/client/pending-original-operation';
import {amendmentTransportFixture} from './quote-amendment-fixture';
import {amendmentAcceptanceReceiptFixture} from './quote-amendment-acceptance-receipt-fixture';
const kinds=['quote.amendment.create','quote.amendment.send','quote.amendment.accept'] as const,fetcher=vi.fn(),signal=()=>new AbortController().signal;
const proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
beforeEach(()=>vi.stubGlobal('fetch',fetcher));afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json','cache-control':'private, no-store'}});
function fixture(kind:typeof kinds[number]){
 const f=amendmentTransportFixture(),accept=amendmentAcceptanceReceiptFixture(),memory=new Map<string,string>(),storage={getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:vi.fn((key:string)=>{memory.delete(key);})},store=createPendingQuoteAmendmentStore(storage,kind),pending={schemaVersion:1 as const,businessId:kind==='quote.amendment.accept'?accept.request.businessId:f.draft.businessId,binding:randomBytes(32).toString('base64url'),reference:kind==='quote.amendment.create'?f.draftReference:kind==='quote.amendment.send'?f.sendReference:accept.reference};
 store.write(pending);return {f,memory,storage,store,pending,target:openPendingOriginalOperation(kind,storage,pending.businessId)!,key:pendingQuoteAmendmentKeys[kind],receipt:kind==='quote.amendment.create'?f.created:kind==='quote.amendment.send'?f.sent:accept.packet};
}
it.each(kinds)('clears %s only after the exact typed original receipt, using its original historical epoch',async kind=>{
 const f=fixture(kind);fetcher.mockResolvedValueOnce(response(f.receipt));expect(await f.target.reconcile(proof(),signal())).toBe('committed');expect(f.store.read()).toBeNull();expect(f.storage.removeItem).toHaveBeenCalledOnce();
 expect(fetcher.mock.calls[0]![0]).toBe('/api/business/quotes/amendments/'+(kind==='quote.amendment.create'?'draft-operation':kind==='quote.amendment.send'?'send-operation':'accept-operation'));
 expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({reference:f.pending.reference});expect(fetcher.mock.calls[0]![1].credentials).toBe('same-origin');
});
it.each(kinds)('retains %s on a verified absent original without retry or removal',async kind=>{
 const f=fixture(kind);fetcher.mockResolvedValueOnce(response({state:'absent'}));expect(await f.target.reconcile(proof(),signal())).toBe('absent');expect(f.store.read()).toEqual(f.pending);expect(f.storage.removeItem).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
});
it.each(kinds.flatMap(kind=>['parent','parent-version','operation','epoch','revision','recorded','replace','abort','transport'].map(fault=>({kind,fault}))))('preserves $kind on $fault evidence or a late answer',async({kind,fault})=>{
 const f=fixture(kind),receipt=structuredClone(f.receipt),controller=new AbortController();
 if(fault==='parent')receipt.receipt.parentAgreementId=randomUUID();if(fault==='parent-version')receipt.receipt.parentAgreementVersion='2';
 if(fault==='operation')receipt.operationId=randomUUID();if(fault==='epoch')receipt.recoveryEpoch=randomUUID();if(fault==='revision')receipt.receipt.revisionId=randomUUID();
 let resolve!:(value:Response)=>void;fetcher.mockImplementationOnce(()=>fault==='transport'?Promise.reject(Error('PRIVATE')):new Promise<Response>(r=>{resolve=r;}));const pending=f.target.reconcile(proof(),controller.signal);
 if(fault==='replace')f.memory.set(f.key,JSON.stringify({...f.pending,binding:randomBytes(32).toString('base64url')}));if(fault==='abort')controller.abort();
 if(fault!=='transport')resolve(response(fault==='recorded'?{schemaVersion:1,state:'original_recorded',original:f.target.original}:receipt));
 await expect(pending).rejects.toThrow(PendingOriginalOperationError);expect(f.memory.has(f.key)).toBe(true);expect(f.storage.removeItem).not.toHaveBeenCalled();
});
