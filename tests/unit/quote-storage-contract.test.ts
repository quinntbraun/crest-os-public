import {randomUUID,createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {quoteFixture} from '../support/quote-fixture';
import {prepareQuoteContent} from '../../src/commercial/quote-content';
import {bindQuoteOriginalReceipt} from '../../src/commercial/quote-original-operation';
import {parseQuoteSave,parseStoredQuoteFamily,parseStoredQuoteRevision,parseStoredQuoteItem,parseQuoteCommitted,parseQuoteDirectoryPage,parseQuoteHistoryPage,quoteInputFromSnapshots} from '../../src/commercial/quote-storage-contract';
const request=(f:ReturnType<typeof quoteFixture>)=>({schemaVersion:1,businessId:f.business,operationId:f.operation,recoveryEpoch:f.recovery,familyId:f.family.id,revisionId:f.revision.id,expectedFamilyVersion:'0',expectedRevisionVersion:'0',content:f.input});
it('round-trips the exact private stored quote and sealed customer-only pricing snapshot',()=>{
 const f=quoteFixture(),family=parseStoredQuoteFamily(f.family,f.business),revision=parseStoredQuoteRevision(f.revision,f.business,f.family.id),items=f.items.map(row=>parseStoredQuoteItem(row,f.business,revision.id));
 expect(family).toEqual(f.family);expect(revision).toEqual(f.revision);expect(items).toEqual(f.items);expect(revision.total_cents).toBe('52500');expect(quoteInputFromSnapshots(revision.customer_safe_snapshot,revision.internal_snapshot)).toEqual(f.input);
 expect(Object.isFrozen(revision.customer_safe_snapshot.lines)).toBe(true);expect(Object.isFrozen(revision.internal_snapshot.sources[0])).toBe(true);
});
it('seals original quote input before asynchronous provider work and keeps paired expected versions',()=>{
 const f=quoteFixture(),source=structuredClone(request(f)),sealed=parseQuoteSave(source);(source.content.recipient as {displayName:string}).displayName='Changed caller';(source.content.lines[0] as {inclusions:string}).inclusions='Changed caller scope';
 expect(sealed.content.recipient.displayName).toBe(f.input.recipient.displayName);expect(sealed.content.lines[0]!.inclusions).toBe(f.input.lines[0]!.inclusions);expect(Object.isFrozen(sealed.content.lines[0])).toBe(true);
 for(const patch of [{expectedFamilyVersion:'0',expectedRevisionVersion:'1'},{expectedFamilyVersion:'1',expectedRevisionVersion:'0'},{operationId:'bad'},{actorId:randomUUID()}])expect(()=>parseQuoteSave({...request(f),...patch})).toThrow();
});
it('rejects foreign or corrupted stored identities, canonical content and computed totals',()=>{
 const f=quoteFixture();expect(()=>parseStoredQuoteFamily(f.family,randomUUID())).toThrow();
 for(const patch of [{total_cents:'1'},{content_version:'2'},{canonical_content:JSON.stringify(JSON.parse(f.revision.canonical_content),null,2)},{content_hash:'not-a-hash'},{family_id:randomUUID()}])expect(()=>parseStoredQuoteRevision({...f.revision,...patch},f.business,f.family.id)).toThrow();
 expect(()=>quoteInputFromSnapshots({...f.prepared.customer,totalCents:'1'},f.prepared.internal)).toThrow();
 expect(()=>quoteInputFromSnapshots({...f.prepared.customer,internalNotes:'private'},f.prepared.internal)).toThrow();
});
it('validates inactive historical line math as strictly as the active customer snapshot',()=>{
 const f=quoteFixture(),row=f.items[0]!;const changed={...row,active:false,position:null,line_discount_cents:'1',final_cents:(BigInt(row.final_cents)-1n).toString(),customer_snapshot:{...row.customer_snapshot,lineDiscountCents:'1',finalCents:(BigInt(row.final_cents)-1n).toString()}};
 expect(()=>parseStoredQuoteItem(changed,f.business,f.revision.id)).toThrow();expect(parseStoredQuoteItem({...row,active:false,position:null},f.business,f.revision.id).active).toBe(false);
 expect(()=>parseStoredQuoteItem({...row,active:true,position:null},f.business,f.revision.id)).toThrow();
});
it('binds complete unique audit receipt identities without accepting a different business or operation',()=>{
 const f=quoteFixture();expect(parseQuoteCommitted(f.committed,f.business,f.operation)).toEqual(f.committed);
 for(const patch of [{itemAuditEventIds:[]},{itemAuditEventIds:[f.committed.receipt.familyAuditEventId]},{contentVersion:'2'},{contentHash:'invalid'}])expect(()=>parseQuoteCommitted({...f.committed,receipt:{...f.committed.receipt,...patch}},f.business,f.operation)).toThrow();
 expect(()=>parseQuoteCommitted(f.committed,randomUUID(),f.operation)).toThrow();expect(()=>parseQuoteCommitted(f.committed,f.business,randomUUID())).toThrow();
});
it('binds the typed saved quote to the original epoch and both exact targets/versions',()=>{
 const f=quoteFixture(),original={schemaVersion:1,businessId:f.business,commandType:'quote.draft.save',reference:{operationId:f.operation,recoveryEpoch:f.recovery,familyId:f.family.id,revisionId:f.revision.id,expectedFamilyVersion:'0',expectedRevisionVersion:'0'}};
 expect(bindQuoteOriginalReceipt(f.committed,original)).toEqual(f.committed);
 for(const patch of [{familyId:randomUUID()},{revisionId:randomUUID()},{familyVersion:'2'},{revisionVersion:'2',contentVersion:'2'}])expect(()=>bindQuoteOriginalReceipt({...f.committed,receipt:{...f.committed.receipt,...patch}},original)).toThrow();
 expect(()=>bindQuoteOriginalReceipt({...f.committed,recoveryEpoch:randomUUID()},original)).toThrow();expect(()=>bindQuoteOriginalReceipt({schemaVersion:1,state:'original_recorded',original},original)).toThrow();
});
it('checks scoped directory pointers and refuses a false complete-page claim',()=>{
 const f=quoteFixture(),req={businessId:f.business,search:'',afterId:null,pageSize:5},page={schemaVersion:1,businessId:f.business,quotes:[{family:f.family,revision:f.revision}],hasMore:false};
 expect(parseQuoteDirectoryPage(page,req).quotes[0]!.revision.id).toBe(f.revision.id);expect(()=>parseQuoteDirectoryPage({...page,hasMore:true},req)).toThrow();expect(()=>parseQuoteDirectoryPage(page,{...req,afterId:f.family.id})).toThrow();
 expect(()=>parseQuoteDirectoryPage({...page,quotes:[{family:{...f.family,current_revision_id:randomUUID()},revision:f.revision}]},req)).toThrow();
});
it('validates contiguous retained history without inventing monotonic wall-clock requirements',()=>{
 const f=quoteFixture(),p=prepareQuoteContent({...f.input,internalNotes:'Changed internal assumption'}),operation=randomUUID(),after={...f.revision,version:'2',content_version:'2',customer_safe_snapshot:p.customer,internal_snapshot:p.internal,canonical_content:p.canonical,content_hash:createHash('sha256').update(p.canonical).digest('hex'),operation_id:operation,updated_at:'2026-10-28T11:59:59.999999Z'};
 const page={schemaVersion:1,businessId:f.business,family:{...f.family,version:'2',operation_id:operation},revision:after,items:f.items,history:[{eventId:randomUUID(),revision:'1',action:'create',at:f.revision.created_at,actorId:f.actor,operationId:f.operation,before:null,after:f.revision},{eventId:randomUUID(),revision:'2',action:'edit',at:after.updated_at,actorId:f.actor,operationId:operation,before:f.revision,after}],hasMore:false},req={businessId:f.business,familyId:f.family.id,revisionId:f.revision.id,afterVersion:'0',pageSize:5};
 expect(parseQuoteHistoryPage(page,req)).toMatchObject({history:[{after:{internal_snapshot:{notes:f.input.internalNotes}}},{after:{internal_snapshot:{notes:'Changed internal assumption'}}}]});
 expect(()=>parseQuoteHistoryPage({...page,history:page.history.slice(1)},req)).toThrow();expect(()=>parseQuoteHistoryPage({...page,hasMore:true},req)).toThrow();expect(()=>parseQuoteHistoryPage({...page,items:[f.items[0]]},req)).toThrow();
});
