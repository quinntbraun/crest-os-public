import {randomUUID,createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {quoteFixture} from '../support/quote-fixture';
import {prepareQuoteReviewContent} from '../../src/commercial/quote-review-content';
import type {QuoteReviewContentInput} from '../../src/commercial/quote-review-content';
import {parseStoredQuoteRevision,parseStoredQuoteItem,parseQuoteCommitted,parseQuoteHistoryPage,quoteInputFromSnapshots} from '../../src/commercial/quote-storage-contract';
import {draftFromQuote,parseQuoteDraft,enableQuoteReviewDraft} from '../../src/client/quote-draft';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const f=quoteFixture(),input:QuoteReviewContentInput={...f.input,schemaVersion:2,documentDiscount:null,lines:[{...f.input.lines[0]!,vehicleId:randomUUID(),jobWide:false,vehicleLabel:'Synthetic SUV',category:'SUV',condition:'Moderate',assessment:{id:randomUUID(),class:'Moderate',source:'photo',assessedAt:'2026-10-28T12:00:00.123456Z',notes:'Private observation'},categoryOverrideNote:null}]},prepared=prepareQuoteReviewContent(input);
 const revision={...f.revision,customer_safe_snapshot:prepared.customer,internal_snapshot:prepared.internal,canonical_content:prepared.canonical,content_hash:sha(prepared.canonical),total_cents:prepared.customer.totalCents},line=input.lines[0]!,priced=prepared.customer.lines[0]!;
 const item={...f.items[0]!,vehicle_id:line.vehicleId,job_wide:false,customer_snapshot:priced,allocated_discount_cents:priced.allocatedDiscountCents,final_cents:priced.finalCents,assessment_id:line.assessment!.id,category_override_note:null};
 return {...f,input,prepared,revision,item};
}
it('reopens version2 content with immutable observation identity and preserves it through editor hydration',()=>{
 const f=fixture(),revision=parseStoredQuoteRevision(f.revision,f.business,f.family.id),item=parseStoredQuoteItem(f.item,f.business,f.revision.id);
 expect(quoteInputFromSnapshots(revision.customer_safe_snapshot,revision.internal_snapshot)).toEqual(f.input);expect(item.assessment_id).toBe(f.input.lines[0]!.assessment!.id);
 const draft=draftFromQuote(revision);expect(draft.contentSchemaVersion).toBe(2);expect(prepareQuoteReviewContent(parseQuoteDraft(draft)).canonical).toBe(f.prepared.canonical);
 expect(()=>parseStoredQuoteItem({...f.item,assessment_id:undefined},f.business,f.revision.id)).toThrow();
});
it('retains review/approval as row changes without changing the content version or offered snapshot',()=>{
 const f=fixture(),submitOperation=randomUUID(),approveOperation=randomUUID(),review={...f.revision,state:'Ready for Review' as const,version:'2',operation_id:submitOperation},approved={...f.revision,state:'Ready for Review' as const,version:'3',operation_id:approveOperation};
 const history=[{eventId:randomUUID(),revision:'1',action:'create',at:f.revision.created_at,actorId:f.actor,operationId:f.operation,before:null,after:f.revision},{eventId:randomUUID(),revision:'2',action:'submit',at:review.updated_at,actorId:f.actor,operationId:submitOperation,before:f.revision,after:review},{eventId:randomUUID(),revision:'3',action:'approve',at:approved.updated_at,actorId:f.actor,operationId:approveOperation,before:review,after:approved}],page={schemaVersion:1,businessId:f.business,family:{...f.family,version:'3',operation_id:approveOperation},revision:approved,items:[f.item],history,hasMore:false},request={businessId:f.business,familyId:f.family.id,revisionId:f.revision.id,afterVersion:'0',pageSize:5};
 const result=parseQuoteHistoryPage(page,request);expect('history' in result&&result.history.map(row=>row.action)).toEqual(['create','submit','approve']);expect('revision' in result&&result.revision.content_version).toBe('1');
 expect(()=>parseQuoteHistoryPage({...page,items:[{...f.item,assessment_id:randomUUID()}]},request)).toThrow();
 expect(()=>parseQuoteHistoryPage({...page,history:[history[0],{...history[1],action:'edit'},history[2]]},request)).toThrow();
 expect(()=>parseQuoteHistoryPage({...page,revision:{...approved,content_version:'3'}},request)).toThrow();
});
it('requires actual assessment completion before accepting a Ready for Review row',()=>{
 const f=fixture(),prepared=prepareQuoteReviewContent({...f.input,lines:[{...f.input.lines[0]!,assessment:null,category:null}]}),revision={...f.revision,state:'Ready for Review',version:'2',customer_safe_snapshot:prepared.customer,internal_snapshot:prepared.internal,canonical_content:prepared.canonical,content_hash:sha(prepared.canonical)};
 expect(()=>parseStoredQuoteRevision(revision,f.business,f.family.id)).toThrow();expect(parseStoredQuoteRevision({...revision,state:'Draft'},f.business,f.family.id).state).toBe('Draft');
});
it('keeps legacy receipts exact and validates additional version2 assessment audit identities',()=>{
 const f=fixture(),assessmentAudit=randomUUID(),result={...f.committed,receipt:{...f.committed.receipt,schemaVersion:2,revisionVersion:'3',contentVersion:'2',assessmentAuditEventIds:[assessmentAudit]}};
 const parsed=parseQuoteCommitted(result,f.business,f.operation);expect(parsed.receipt.schemaVersion).toBe(2);expect(Object.isFrozen(parsed.receipt)).toBe(true);
 for(const patch of [{assessmentAuditEventIds:[f.committed.receipt.itemAuditEventIds[0]!]},{contentVersion:'4'},{assessmentAuditEventIds:undefined},{schemaVersion:1}])expect(()=>parseQuoteCommitted({...result,receipt:{...result.receipt,...patch}},f.business,f.operation)).toThrow();
 expect(parseQuoteCommitted(f.committed,f.business,f.operation)).toEqual(f.committed);
});
it('preserves entered but incomplete observations for correction instead of silently saving without them',()=>{
 const f=fixture(),draft=draftFromQuote(f.revision),line=draft.lines[0]!,raw={id:randomUUID(),source:'photo' as const,wall:'',instant:'',exact:'',notes:'An entered observation'};
 expect(()=>parseQuoteDraft({...draft,lines:[{...line,assessmentDraft:raw}]})).toThrow('assessment');
 const complete={...raw,wall:'2026-10-28T08:00',instant:'2026-10-28T12:00:00.123456Z',exact:'2026-10-28T12:00:00.123456Z'};
 const result=prepareQuoteReviewContent(parseQuoteDraft({...draft,lines:[{...line,assessmentDraft:complete}]}));expect(result.internal.sources[0]!.assessment?.notes).toBe(raw.notes);expect(result.internal.sources[0]!.assessment?.id).toBe(raw.id);
 expect(()=>parseQuoteDraft({...draft,contentSchemaVersion:1})).toThrow('assessment');
 const old=quoteFixture(),upgraded=enableQuoteReviewDraft(draftFromQuote(old.revision)),prepared=prepareQuoteReviewContent(parseQuoteDraft(upgraded));expect(prepared.internal.sources[0]!.assessment).toBeNull();expect(prepared.customer.lines[0]!.category).toBeNull();
});
