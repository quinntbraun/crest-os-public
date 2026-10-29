import {randomUUID,createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {quoteFixture} from '../support/quote-fixture';
import {prepareQuoteReviewContent} from '../../src/commercial/quote-review-content';
import {parseQuoteDirectoryPage,parseQuoteHistoryPage,parseStoredQuoteRevision} from '../../src/commercial/quote-storage-contract';
import type {StoredQuoteRevision} from '../../src/commercial/quote-storage-contract';
function fixture(){
 const f=quoteFixture(),p=prepareQuoteReviewContent({...f.input,schemaVersion:2,lines:f.input.lines.map(line=>({...line,category:null,assessment:null,categoryOverrideNote:null}))}),base={...f.revision,customer_safe_snapshot:p.customer,internal_snapshot:p.internal,canonical_content:p.canonical,content_hash:createHash('sha256').update(p.canonical).digest('hex')};
 const states=['Draft','Ready for Review','Ready for Review','Sent','Sent','Accepted'] as const,actions=['create','submit','approve','send','send','accept'] as const,rows:StoredQuoteRevision[]=states.map((state,i)=>({...base,state,version:String(i+1),operation_id:randomUUID()}));
 const history=rows.map((after,i)=>({eventId:randomUUID(),revision:after.version,action:actions[i]!,at:after.updated_at,actorId:after.updated_by,operationId:after.operation_id,before:i===0?null:rows[i-1]!,after})),items=f.items.map((item,i)=>({...item,customer_snapshot:p.customer.lines[i]!,assessment_id:null,category_override_note:null}));
 const request={businessId:f.business,familyId:f.family.id,revisionId:f.revision.id,afterVersion:'0',pageSize:5};
 const page={schemaVersion:1,businessId:f.business,family:{...f.family,version:'6'},revision:rows[5]!,items,history:history.slice(0,5),hasMore:true};
 return {f,p,rows,history,items,request,page};
}
it('reads exact current Sent/Accepted and old Superseded rows without downgrading content or state',()=>{
 const f=fixture();for(const state of ['Sent','Accepted','Superseded'] as const){const row={...f.rows[5]!,state};expect(parseStoredQuoteRevision(row,f.f.business,f.f.family.id)).toEqual(row);expect(()=>parseStoredQuoteRevision({...f.f.revision,state},f.f.business,f.f.family.id)).toThrow();}
 const incomplete=prepareQuoteReviewContent({...f.f.input,schemaVersion:2,lines:f.f.input.lines.map((line,i)=>({...line,vehicleId:randomUUID(),jobWide:false,vehicleLabel:'Synthetic unassessed '+i,category:null,assessment:null,categoryOverrideNote:null}))});
 expect(()=>parseStoredQuoteRevision({...f.rows[5],customer_safe_snapshot:incomplete.customer,internal_snapshot:incomplete.internal,canonical_content:incomplete.canonical,content_hash:createHash('sha256').update(incomplete.canonical).digest('hex')},f.f.business,f.f.family.id)).toThrow();
});
it('retains create/review/repeated-send/accept history over both pages without mutating content version',()=>{
 const f=fixture(),first=parseQuoteHistoryPage(f.page,f.request);expect(first).toMatchObject({revision:{state:'Accepted',version:'6',content_version:'1'},history:[{action:'create'},{action:'submit'},{action:'approve'},{action:'send'},{action:'send'}],hasMore:true});
 const last=parseQuoteHistoryPage({...f.page,history:f.history.slice(5),hasMore:false},{...f.request,afterVersion:'5'});expect(last).toMatchObject({history:[{action:'accept',before:{state:'Sent'},after:{state:'Accepted'}}],hasMore:false});
});
it('allows a tenant-bound historical revision after replacement changes the current pointer but keeps directory pointers strict',()=>{
 const f=fixture(),old={...f.rows[5]!,state:'Superseded' as const},before={...old,state:'Sent' as const,version:'5'},operationId=randomUUID(),after={...old,operation_id:operationId},family={...f.page.family,current_revision_id:randomUUID()},history=[{eventId:randomUUID(),revision:'6',action:'send',at:after.updated_at,actorId:after.updated_by,operationId,before,after}];
 expect(parseQuoteHistoryPage({...f.page,family,revision:after,history,hasMore:false},{...f.request,afterVersion:'5'})).toMatchObject({family:{current_revision_id:family.current_revision_id},revision:{state:'Superseded'}});
 expect(()=>parseQuoteDirectoryPage({schemaVersion:1,businessId:f.f.business,quotes:[{family,revision:after}],hasMore:false},{businessId:f.f.business,search:'',afterId:null,pageSize:5})).toThrow();
});
it('refuses changed content under send/accept, unapproved send, terminal reopening and invented history actions',()=>{
 const f=fixture(),before=f.rows[4]!,after=f.rows[5]!,event=f.history[5]!;
 for(const bad of [{...event,action:'edit',after:{...after,state:'Draft'}},{...event,action:'send',before:{...before,state:'Draft'},after:{...after,state:'Sent'}},{...event,action:'accept',after:{...after,content_version:'2'}},{...event,action:'cancel'},{...event,before:{...before,state:'Accepted'}},{...event,after:{...after,total_cents:'1'}}])expect(()=>parseQuoteHistoryPage({...f.page,revision:bad.after,history:[bad],hasMore:false},{...f.request,afterVersion:'5'})).toThrow();
});
