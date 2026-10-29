// Unit transport/storage doubles prove lifecycle/refusal, not genuine Auth/SQL.
import {randomBytes,randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
import {createQuoteCommercialController} from '../../src/client/quote-commercial-controller';
import {quoteCommercial,QuoteCommercialClientError} from '../../src/client/quote-commercial';
import {createPendingQuoteCommercialStore} from '../../src/client/pending-quote-commercial';
import {createPendingQuoteStore} from '../../src/client/pending-quote-edit';
import {createPendingQuoteReviewStore} from '../../src/client/pending-quote-review';
import {commercialFixture,commercialSend,commercialAccept,commercialCommitted} from './quote-commercial-fixture';
import {quotes} from '../../src/client/quotes';
const api={read:vi.fn<typeof quoteCommercial.read>(),send:vi.fn<typeof quoteCommercial.send>(),accept:vi.fn<typeof quoteCommercial.accept>(),lookup:vi.fn<typeof quoteCommercial.lookup>()},session=vi.fn(),context=vi.fn<typeof quotes.context>(),change=vi.fn(),onCommitted=vi.fn(),id=vi.fn(),binding=randomBytes(32).toString('base64url');
let f:ReturnType<typeof commercialFixture>,memory:Map<string,string>,storage:{getItem:ReturnType<typeof vi.fn<(key:string)=>string|null>>;setItem:ReturnType<typeof vi.fn<(key:string,value:string)=>void>>;removeItem:ReturnType<typeof vi.fn<(key:string)=>void>>},store:ReturnType<typeof createPendingQuoteCommercialStore>,draftStore:ReturnType<typeof createPendingQuoteStore>,reviewStore:ReturnType<typeof createPendingQuoteReviewStore>,events:string[];
const proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000}),fresh=()=>({context:{schemaVersion:1 as const,businessId:f.f.business,writeState:'ready' as const,recoveryEpoch:f.f.recovery},binding});
const create=()=>createQuoteCommercialController({api,store,draftStore,reviewStore,change,onCommitted,session,context,id});
beforeEach(()=>{
 vi.resetAllMocks();f=commercialFixture('Ready for Review');memory=new Map();events=[];
 storage={getItem:vi.fn(key=>memory.get(key)??null),setItem:vi.fn((key,value)=>{events.push('persist');memory.set(key,value);}),removeItem:vi.fn(key=>{memory.delete(key);})};store=createPendingQuoteCommercialStore(storage);draftStore=createPendingQuoteStore(storage);reviewStore=createPendingQuoteReviewStore(storage);
 session.mockImplementation(async()=>{events.push('session');return proof();});context.mockImplementation(async()=>{events.push('context');return fresh();});id.mockImplementation(()=>randomUUID());api.read.mockImplementation(async()=>{events.push('read');return f.packet as Awaited<ReturnType<typeof quoteCommercial.read>>;});
 api.send.mockImplementation(async input=>{events.push('dispatch');store.require(store.read()!);return commercialCommitted(input);});api.accept.mockImplementation(async input=>{events.push('dispatch');store.require(store.read()!);return commercialCommitted(input,2,f.approval.id);});
});
it('freshly verifies the exact quote then acknowledges opaque storage before one manual-sharing dispatch',async()=>{
 const c=create();await c.read(f.row);expect(c.view().canSend).toBe(true);events.length=0;await c.send(f.row,commercialSend(f).body);expect(events).toEqual(['session','context','read','persist','dispatch']);expect(api.send).toHaveBeenCalledTimes(1);expect(store.read()).toBeNull();expect(onCommitted).toHaveBeenCalledTimes(1);expect(c.view()).toMatchObject({phase:'review',current:null,pending:null});
 const saved=storage.setItem.mock.calls[0]![1];for(const secret of [f.packet.contentHash,f.approval.presentationHash,'PRIVATE_SYNTHETIC_SHARING_EVIDENCE','recipientSnapshot','expectedHash'])expect(saved).not.toContain(secret);expect(Object.keys(JSON.parse(saved).reference)).toHaveLength(10);
});
it('records exact customer acceptance IDs, whole-quote scope and chosen actual send after fresh read',async()=>{
 f=commercialFixture('Sent');const c=create();await c.read(f.row);expect(c.view().canAccept).toBe(true);const body=commercialAccept(f).body;await c.accept(f.row,body);const input=api.accept.mock.calls[0]![0];expect(input.body).toEqual(body);expect(onCommitted.mock.calls[0]![0].receipt).toMatchObject({action:'accept',sendId:body.sendId,customerId:body.customerId,acceptanceId:input.acceptanceId,agreementId:input.agreementId});expect(store.read()).toBeNull();
});
it('seals private caller confirmation facts before asynchronous fresh authority checks',async()=>{
 const c=create();await c.read(f.row);let release!:(value:ReturnType<typeof proof>)=>void;session.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const raw=structuredClone(commercialSend(f).body),before=raw.recipientSnapshot.displayName,pending=c.send(f.row,raw);(raw.recipientSnapshot as {displayName:string}).displayName='Changed caller';release(proof());await pending;expect(api.send.mock.calls[0]![0].body.recipientSnapshot.displayName).toBe(before);
});
it.each(['binding','epoch'] as const)('refuses changed %s before writing metadata or sending',async field=>{
 const c=create();await c.read(f.row);context.mockResolvedValueOnce(field==='binding'?{...fresh(),binding:randomBytes(32).toString('base64url')}:{...fresh(),context:{...fresh().context,recoveryEpoch:randomUUID()}});await c.send(f.row,commercialSend(f).body);expect(api.send).not.toHaveBeenCalled();expect(storage.setItem).not.toHaveBeenCalled();expect(c.view()).toMatchObject({phase:'review',current:null});
});
it.each(['draft','review'] as const)('blocks alongside an unresolved %s operation without consuming its original',async kind=>{
 const common={operationId:randomUUID(),recoveryEpoch:f.f.recovery,familyId:f.f.family.id,revisionId:f.f.revision.id,expectedFamilyVersion:'6',expectedRevisionVersion:'6'};
 if(kind==='draft')draftStore.write({schemaVersion:1,businessId:f.f.business,binding,reference:common});else reviewStore.write({schemaVersion:1,businessId:f.f.business,binding,reference:{...common,action:'submit',expectedContentVersion:'1',approvalId:null}});
 const before=[...memory];const c=create();await c.read(f.row);expect(c.view().phase).toBe('blocked');expect(api.read).not.toHaveBeenCalled();expect([...memory]).toEqual(before);expect(api.send).not.toHaveBeenCalled();
});
it('refuses dispatch after storage failure and preserves any acknowledged reference on clear failure',async()=>{
 const c=create();await c.read(f.row);storage.setItem.mockImplementationOnce(()=>{throw Error('Private storage');});await c.send(f.row,commercialSend(f).body);expect(api.send).not.toHaveBeenCalled();
 const next=create();await next.read(f.row);storage.removeItem.mockImplementation(()=>{});await next.send(f.row,commercialSend(f).body);expect(store.read()).not.toBeNull();expect(next.view().status).toContain('reference could not be cleared');expect(onCommitted).not.toHaveBeenCalled();
});
it('keeps a lost acknowledgment without retry and resolves only the exact original receipt',async()=>{
 api.send.mockRejectedValueOnce(new QuoteCommercialClientError('unknown'));const c=create();await c.read(f.row);await c.send(f.row,commercialSend(f).body);const original=store.read()!,request=api.send.mock.calls[0]![0];expect(c.view()).toMatchObject({phase:'pending',current:null});expect(original.reference.action).toBe('send');await Promise.resolve();expect(api.send).toHaveBeenCalledTimes(1);
 api.lookup.mockResolvedValueOnce(commercialCommitted(request));await c.lookup();expect(api.lookup.mock.calls[0]![1]).toEqual(original.reference);expect(store.read()).toBeNull();expect(onCommitted).toHaveBeenCalledTimes(1);expect(api.send).toHaveBeenCalledTimes(1);
});
it('keeps an absent original and a foreign sign-in binding blocked instead of clearing/replacing it',async()=>{
 api.send.mockRejectedValueOnce(new QuoteCommercialClientError('unknown'));const c=create();await c.read(f.row);await c.send(f.row,commercialSend(f).body);const original=store.read();api.lookup.mockResolvedValueOnce({state:'absent'});await c.lookup();expect(store.read()).toEqual(original);expect(c.view().status).toContain('does not prove failure');
 context.mockResolvedValueOnce({...fresh(),binding:randomBytes(32).toString('base64url')});await c.lookup();expect(c.view().phase).toBe('blocked');expect(api.lookup).toHaveBeenCalledTimes(1);expect(store.read()).toEqual(original);
});
it.each(['operation','version','accepted'] as const)('retains only the unresolved original operation on %s conflict',async reason=>{
 api.send.mockResolvedValueOnce(reason==='version'?{state:'conflict',reason,currentFamilyVersion:'7',currentRevisionVersion:'7'}:{state:'conflict',reason});const c=create();await c.read(f.row);await c.send(f.row,commercialSend(f).body);expect(store.read()!==null).toBe(reason==='operation');expect(onCommitted).not.toHaveBeenCalled();
});
it.each(['scope','approval'] as const)('withholds substituted acceptance %s receipts and keeps their original reference',async wrong=>{
 f=commercialFixture('Sent');api.accept.mockImplementationOnce(async input=>commercialCommitted(input,wrong==='scope'?1:2,wrong==='approval'?randomUUID():f.approval.id));const c=create();await c.read(f.row);await c.accept(f.row,commercialAccept(f).body);expect(store.read()).not.toBeNull();expect(c.view().phase).toBe('pending');expect(onCommitted).not.toHaveBeenCalled();
});
it('hiding or disposing during dispatch aborts and ignores late confirmation while preserving only metadata',async()=>{
 let release!:(value:ReturnType<typeof commercialCommitted>)=>void;api.send.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const c=create();await c.read(f.row);const pending=c.send(f.row,commercialSend(f).body);await vi.waitFor(()=>expect(api.send).toHaveBeenCalledTimes(1));const request=api.send.mock.calls[0]![0],before=store.read();c.clearPrivate();expect(api.send.mock.calls[0]![2].aborted).toBe(true);expect(c.view().current).toBeNull();c.dispose();release(commercialCommitted(request));await pending;expect(store.read()).toEqual(before);expect(onCommitted).not.toHaveBeenCalled();
});
it.each(['Accepted','Superseded'] as const)('reads retained %s facts without offering mutations or fabricated replacement',async state=>{
 f=commercialFixture(state);const c=create();await c.read(f.row);expect(c.view()).toMatchObject({phase:'ready',canSend:false,canAccept:false,current:{state}});await c.send(f.row,commercialSend(f).body);expect(api.send).not.toHaveBeenCalled();
});

it('records a reviewed replacement only with the exact still-active prior offer pointer',async()=>{
 const prior=randomUUID();f.packet.control={schemaVersion:1,version:'2',activeOfferId:prior,initialAcceptanceId:null,acceptedRevisionId:null,currentAgreementId:null};
 const c=create();await c.read(f.row);expect(c.view().canSend).toBe(true);
 await c.send(f.row,commercialSend(f).body);expect(api.send).not.toHaveBeenCalled();expect(store.read()).toBeNull();
 await c.send(f.row,{...commercialSend(f).body,replacesRevisionId:prior});expect(api.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({body:expect.objectContaining({replacesRevisionId:prior})}),expect.any(Object),expect.any(AbortSignal));
});
it('refuses a prior offer that changed during the final fresh replacement read',async()=>{
 const prior=randomUUID();f.packet.control={schemaVersion:1,version:'2',activeOfferId:prior,initialAcceptanceId:null,acceptedRevisionId:null,currentAgreementId:null};const c=create();await c.read(f.row);
 f.packet.control={...f.packet.control,activeOfferId:randomUUID()};await c.send(f.row,{...commercialSend(f).body,replacesRevisionId:prior});expect(api.send).not.toHaveBeenCalled();expect(store.read()).toBeNull();
});
it('allows accepting the actual prior active offer while a newer replacement remains a Draft',async()=>{
 f=commercialFixture('Sent');f.row.family.current_revision_id=randomUUID();const c=create();await c.read(f.row);expect(c.view().canSend).toBe(false);expect(c.view().canAccept).toBe(true);
 await c.accept(f.row,commercialAccept(f).body);expect(api.accept).toHaveBeenCalledTimes(1);expect(store.read()).toBeNull();
});

it('refuses sharing if an unresolved replacement appears after the first read',async()=>{
 let replacement:unknown=null;const blocker={read:()=>replacement};const c=createQuoteCommercialController({api,store,draftStore,reviewStore,blockers:[blocker],change,onCommitted,session,context,id});
 await c.read(f.row);expect(c.view().canSend).toBe(true);replacement={operationId:randomUUID()};await c.send(f.row,commercialSend(f).body);
 expect(api.send).not.toHaveBeenCalled();expect(storage.setItem).not.toHaveBeenCalled();expect(c.view().phase).toBe('blocked');expect(replacement).not.toBeNull();
});
