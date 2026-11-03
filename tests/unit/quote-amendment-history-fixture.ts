import {randomUUID,createHash} from 'node:crypto';
import {vi} from 'vitest';
import {amendmentTargetFixture} from './quote-amendment-target-fixture';
import {prepareQuoteReviewContent} from '../../src/commercial/quote-review-content';
import {parseQuoteAmendmentRead} from '../../src/commercial/quote-amendment-read';
import {quoteInputFromSnapshots,parseStoredQuoteAmendmentRevision} from '../../src/commercial/quote-storage-contract';
import type {QuoteAmendmentReadRequest} from '../../src/commercial/quote-amendment-read';
export async function amendmentHistoryFixture(count=8){
 const f=amendmentTargetFixture(true),base=parseStoredQuoteAmendmentRevision(f.target.revision,f.target.family.business_id,f.target.family.id),input=quoteInputFromSnapshots(base.customer_safe_snapshot,base.internal_snapshot),history=[];let before:typeof base|null=null;
 for(let index=0;index<count;index++){const p=prepareQuoteReviewContent({...input,title:index%2?"'Café \\N 🚗":'=SUM(1,2)',internalNotes:index===0?null: 'PRIVATE_SYNTHETIC\n"Notes" \\N'}),row={...base,version:String(index+1),content_version:String(index+1),customer_safe_snapshot:p.customer,internal_snapshot:p.internal,canonical_content:p.canonical,content_hash:createHash('sha256').update(p.canonical).digest('hex'),total_cents:p.customer.totalCents,operation_id:randomUUID()};history.push({eventId:randomUUID(),revision:row.version,action:index===0?'create' as const:'edit' as const,at:row.updated_at,actorId:row.updated_by,operationId:row.operation_id,before,after:row});before=row;}
 const revision=history.at(-1)!.after,family={...f.target.family,version:String(6+count)},items=f.f.f.f.items.map((item,index)=>({...item,revision_id:revision.id,customer_snapshot:revision.customer_safe_snapshot.lines[index],assessment_id:null,category_override_note:null})),packet={schemaVersion:1,businessId:family.business_id,family,revision,parent:f.target.parent,control:f.target.control,items,approval:null,latestSend:null,history,hasMore:false},request={businessId:family.business_id,familyId:family.id,revisionId:revision.id,afterVersion:'0',pageSize:5};
 const page=(r:QuoteAmendmentReadRequest)=>({...packet,history:packet.history.filter(event=>BigInt(event.revision)>BigInt(r.afterVersion)).slice(0,r.pageSize),hasMore:BigInt(revision.version)>BigInt(r.afterVersion)+BigInt(r.pageSize)}),read=vi.fn(async(r:QuoteAmendmentReadRequest)=>parseQuoteAmendmentRead(page(r),r)),head=await read(request);if('state'in head)throw Error();read.mockClear();return {f,head,history,packet,request,page,read};
}
