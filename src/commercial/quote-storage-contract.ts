// Data-only private quote boundary. This grants no session/database authority.
import {customerUuid,customerVersion,customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseQuoteContentLine} from './quote-content.ts';
import {prepareVersionedQuoteContent as prepareQuoteContent,parseQuoteReviewLine,quoteReviewReadiness} from './quote-review-content.ts';
import type {VersionedQuoteContentInput as QuoteContentInput} from './quote-review-content.ts';
import type {QuoteDiscount} from './quote-pricing.ts';
import {calculateQuote} from './quote-pricing.ts';
export const quoteBodyLimit=131072,quoteResponseLimit=4194304,quoteHistoryPageLimit=5;
export class QuoteStorageError extends Error{constructor(){super('QUOTE_STORAGE_DATA_INVALID');this.name='QuoteStorageError';}}
export function requireQuoteStorage(value:unknown):asserts value{if(!value)throw new QuoteStorageError();}
const check:(value:unknown)=>asserts value=requireQuoteStorage;
export const quoteId=(v:unknown):v is string=>typeof v==='string'&&v===v.trim()&&customerUuid(v);
export const quoteVersion=(v:unknown,zero=false):v is string=>typeof v==='string'&&v===v.trim()&&customerVersion(v,zero);
const instant=(v:unknown):v is string=>typeof v==='string'&&v.length===27&&customerInstant(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
type Prepared=ReturnType<typeof prepareQuoteContent>;
type Provenance=Readonly<{id:string;business_id:string;created_at:string;updated_at:string;created_by:string;updated_by:string;origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null}>;
export const quoteFamilyColumns=['id','business_id','lead_id','customer_id','current_revision_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export const quoteRevisionColumns=['id','business_id','family_id','sequence','kind','state','version','content_version','customer_safe_snapshot','internal_snapshot','canonical_content','content_hash','total_cents','expiry_at','timezone','tax_readiness','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export const quoteItemColumns=['id','business_id','revision_id','stable_line_key','active','position','vehicle_id','job_wide','service_version_id','gross_cents','line_discount','document_discount_eligible','line_discount_cents','allocated_discount_cents','final_cents','complimentary_reason','customer_snapshot','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export const quoteReviewItemColumns=[...quoteItemColumns,'assessment_id','category_override_note'] as const;
export type StoredQuoteFamily=Provenance&Readonly<{lead_id:string|null;customer_id:string|null;current_revision_id:string;version:string}>;
export type StoredQuoteRevision=Provenance&Readonly<{family_id:string;sequence:string;kind:'initial';state:'Draft'|'Ready for Review';version:string;content_version:string;customer_safe_snapshot:Prepared['customer'];internal_snapshot:Prepared['internal'];canonical_content:string;content_hash:string;total_cents:string;expiry_at:string|null;timezone:string;tax_readiness:'not_configured'}>;
export type StoredQuoteItem=Provenance&Readonly<{revision_id:string;stable_line_key:string;active:boolean;position:number|null;vehicle_id:string|null;job_wide:boolean;service_version_id:string|null;gross_cents:string;line_discount:QuoteDiscount|null;document_discount_eligible:boolean;line_discount_cents:string;allocated_discount_cents:string;final_cents:string;complimentary_reason:string|null;customer_snapshot:Prepared['customer']['lines'][number];version:string;assessment_id?:string|null;category_override_note?:string|null}>;
export type QuoteSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string;content:QuoteContentInput}>;
export type QuoteReceipt=Readonly<{businessId:string;familyId:string;familyVersion:string;revisionId:string;revisionVersion:string;contentVersion:string;contentHash:string;familyAuditEventId:string;revisionAuditEventId:string;itemAuditEventIds:readonly string[]}>&(Readonly<{schemaVersion:1}>|Readonly<{schemaVersion:2;assessmentAuditEventIds:readonly string[]}>);
export type QuoteCommitted=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:QuoteReceipt}>;
const customerKeys=['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents'] as const;
const publicLineKeys=['description','inclusions','exclusions','vehicle','condition','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason'] as const;
function sameData(a:unknown,b:unknown):boolean{
 if(a===b)return true;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameData(v,b[i]));
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);
 return keys.length===Object.keys(right).length&&keys.every(k=>Object.hasOwn(right,k)&&sameData(left[k],right[k]));
}
/** Reconstitute only validated input fields; output totals are recalculated. */
export function quoteInputFromSnapshots(customer:unknown,internal:unknown):QuoteContentInput{
 check(exact(customer,customerKeys)&&exact(customer.recipient,['displayName','phone','email'])&&Array.isArray(customer.lines)
  &&[1,2].includes(customer.schemaVersion as number)&&exact(internal,['customerId','leadId','notes','sources','extremeReviewRequired'])&&Array.isArray(internal.sources)&&internal.sources.length===customer.lines.length);
 const version=customer.schemaVersion as 1|2;
 const sources=internal.sources;
 const lines=customer.lines.map((row,index)=>{
  const source=sources[index];check(exact(row,version===1?publicLineKeys:[...publicLineKeys,'category'])&&exact(source,version===1?['stableLineKey','vehicleId','jobWide','serviceVersionId']:['stableLineKey','vehicleId','jobWide','serviceVersionId','assessment','categoryOverrideNote']));
  const base={id:source.stableLineKey,vehicleId:source.vehicleId,jobWide:source.jobWide,vehicleLabel:row.vehicle,serviceVersionId:source.serviceVersionId,description:row.description,inclusions:row.inclusions,exclusions:row.exclusions,condition:row.condition,grossCents:row.grossCents,lineDiscount:row.lineDiscount,documentDiscountEligible:row.documentDiscountEligible,complimentaryReason:row.complimentaryReason};
  return version===1?parseQuoteContentLine(base):parseQuoteReviewLine({...base,category:row.category,assessment:source.assessment,categoryOverrideNote:source.categoryOverrideNote});
 });
 const input={schemaVersion:version,title:customer.title,recipient:{customerId:internal.customerId,leadId:internal.leadId,displayName:customer.recipient.displayName,phone:customer.recipient.phone,email:customer.recipient.email},workLocation:customer.workLocation,terms:customer.terms,timezone:customer.timezone,expiryAt:customer.expiryAt,proposedSchedule:customer.proposedSchedule,internalNotes:internal.notes,documentDiscount:customer.documentDiscount,lines};
 const prepared=prepareQuoteContent(input);check(sameData(prepared.customer,customer)&&sameData(prepared.internal,internal));
 return Object.freeze({schemaVersion:version,title:prepared.customer.title,recipient:Object.freeze({customerId:prepared.internal.customerId,leadId:prepared.internal.leadId,...prepared.customer.recipient}),workLocation:prepared.customer.workLocation,terms:prepared.customer.terms,timezone:prepared.customer.timezone,expiryAt:prepared.customer.expiryAt,proposedSchedule:prepared.customer.proposedSchedule,internalNotes:prepared.internal.notes,documentDiscount:prepared.customer.documentDiscount,lines:Object.freeze(lines)}) as QuoteContentInput;
}
export function parseQuoteSave(v:unknown):QuoteSave{
 check(exact(v,['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','content'])&&v.schemaVersion===1&&quoteId(v.businessId)&&quoteId(v.operationId)&&quoteId(v.recoveryEpoch)&&quoteId(v.familyId)&&quoteId(v.revisionId)&&quoteVersion(v.expectedFamilyVersion,true)&&quoteVersion(v.expectedRevisionVersion,true)&&(v.expectedFamilyVersion==='0')===(v.expectedRevisionVersion==='0'));
 const p=prepareQuoteContent(v.content),content=quoteInputFromSnapshots(p.customer,p.internal);
 return Object.freeze({...v,content}) as QuoteSave;
}
function provenance(v:Record<string,unknown>,business:string){
 check(quoteId(business)&&v.business_id===business&&quoteId(v.id)&&instant(v.created_at)&&instant(v.updated_at)&&quoteId(v.created_by)&&quoteId(v.updated_by)&&quoteId(v.operation_id)&&['manual','import','system'].includes(v.origin as string)&&(v.import_row_id===null||quoteId(v.import_row_id)));
}
export function parseStoredQuoteFamily(v:unknown,business:string):StoredQuoteFamily{
 check(exact(v,quoteFamilyColumns));provenance(v,business);check((v.customer_id===null||quoteId(v.customer_id))&&(v.lead_id===null||quoteId(v.lead_id))&&(v.customer_id!==null||v.lead_id!==null)&&quoteId(v.current_revision_id)&&quoteVersion(v.version));return Object.freeze({...v}) as StoredQuoteFamily;
}
export function parseStoredQuoteRevision(v:unknown,business:string,family:string):StoredQuoteRevision{
 check(exact(v,quoteRevisionColumns));provenance(v,business);check(quoteId(family)&&v.family_id===family&&quoteVersion(v.sequence)&&v.kind==='initial'&&['Draft','Ready for Review'].includes(v.state as string)&&quoteVersion(v.version)&&quoteVersion(v.content_version)&&BigInt(v.content_version)<=BigInt(v.version)&&hash(v.content_hash)&&quoteVersion(v.total_cents,true)&&v.tax_readiness==='not_configured');
 const content=quoteInputFromSnapshots(v.customer_safe_snapshot,v.internal_snapshot),p=prepareQuoteContent(content);check(v.canonical_content===p.canonical&&v.total_cents===p.customer.totalCents&&v.timezone===p.customer.timezone&&v.expiry_at===p.customer.expiryAt);
 check(content.schemaVersion===2||v.state==='Draft'&&v.content_version===v.version);
 if(v.state==='Ready for Review')check(quoteReviewReadiness(content)===null);
 return Object.freeze({...v,customer_safe_snapshot:p.customer,internal_snapshot:p.internal}) as StoredQuoteRevision;
}
export function parseStoredQuoteItem(v:unknown,business:string,revision:string):StoredQuoteItem{
 check(exact(v,quoteItemColumns)||exact(v,quoteReviewItemColumns));provenance(v,business);check(quoteId(revision)&&v.revision_id===revision&&quoteId(v.stable_line_key)&&typeof v.active==='boolean'&&(v.active?Number.isSafeInteger(v.position)&&Number(v.position)>=1&&Number(v.position)<=1000:v.position===null)&&quoteVersion(v.version)&&(exact(v.customer_snapshot,publicLineKeys)||exact(v.customer_snapshot,[...publicLineKeys,'category'])));
 const s=v.customer_snapshot,line=parseQuoteContentLine({id:v.stable_line_key,vehicleId:v.vehicle_id,jobWide:v.job_wide,vehicleLabel:s.vehicle,serviceVersionId:v.service_version_id,description:s.description,inclusions:s.inclusions,exclusions:s.exclusions,condition:s.condition,grossCents:v.gross_cents,lineDiscount:v.line_discount,documentDiscountEligible:v.document_discount_eligible,complimentaryReason:v.complimentary_reason});
 if(Object.hasOwn(s,'category')){check(exact(v,quoteReviewItemColumns)&&(v.assessment_id===null||quoteId(v.assessment_id)));parseQuoteReviewLine({...line,category:s.category,assessment:null,categoryOverrideNote:v.category_override_note});}else check(exact(v,quoteItemColumns));
 check(quoteVersion(v.line_discount_cents,true)&&quoteVersion(v.allocated_discount_cents,true)&&quoteVersion(v.final_cents,true)&&BigInt(v.final_cents)===BigInt(line.grossCents)-BigInt(v.line_discount_cents)-BigInt(v.allocated_discount_cents)
  &&v.line_discount_cents===calculateQuote([{id:line.id,grossCents:line.grossCents,lineDiscount:line.lineDiscount,documentDiscountEligible:line.documentDiscountEligible,complimentaryReason:line.complimentaryReason}],null).lines[0]!.lineDiscountCents&&(line.documentDiscountEligible||v.allocated_discount_cents==='0')&&(v.final_cents!=='0'||line.complimentaryReason!==null));
 check(s.grossCents===line.grossCents&&sameData(s.lineDiscount,line.lineDiscount)&&s.lineDiscountCents===v.line_discount_cents&&s.allocatedDiscountCents===v.allocated_discount_cents&&s.finalCents===v.final_cents&&s.documentDiscountEligible===line.documentDiscountEligible&&s.complimentaryReason===line.complimentaryReason);
 return Object.freeze({...v,line_discount:line.lineDiscount,customer_snapshot:Object.freeze({...s,lineDiscount:line.lineDiscount})}) as StoredQuoteItem;
}
export function parseQuoteCommitted(v:unknown,business:string,operation:string):QuoteCommitted{
 check(quoteId(business)&&quoteId(operation)&&exact(v,['state','operationId','recoveryEpoch','receipt'])&&v.state==='committed'&&v.operationId===operation&&quoteId(v.recoveryEpoch));
 const r=v.receipt,keys=['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds'];
 check(exact(r,keys)||exact(r,[...keys,'assessmentAuditEventIds']));
 check((r.schemaVersion===1||r.schemaVersion===2)&&exact(r,r.schemaVersion===1?keys:[...keys,'assessmentAuditEventIds'])&&r.businessId===business&&quoteId(r.familyId)&&quoteId(r.revisionId)&&quoteVersion(r.familyVersion)&&quoteVersion(r.revisionVersion)&&quoteVersion(r.contentVersion)&&(r.schemaVersion===1?r.contentVersion===r.revisionVersion:BigInt(r.contentVersion)<=BigInt(r.revisionVersion))&&hash(r.contentHash)&&quoteId(r.familyAuditEventId)&&quoteId(r.revisionAuditEventId)&&r.familyAuditEventId!==r.revisionAuditEventId&&Array.isArray(r.itemAuditEventIds)&&r.itemAuditEventIds.length<=2000&&r.itemAuditEventIds.every(quoteId));
 const assessments=r.schemaVersion===2?r.assessmentAuditEventIds:[];check(Array.isArray(assessments)&&assessments.length<=1000&&assessments.every(quoteId));
 const ids=[r.familyAuditEventId,r.revisionAuditEventId,...r.itemAuditEventIds,...assessments];check(new Set(ids).size===ids.length);
 check(r.revisionVersion!=='1'||r.itemAuditEventIds.length>0);
 return Object.freeze({state:'committed',operationId:operation,recoveryEpoch:v.recoveryEpoch,receipt:Object.freeze({...r,itemAuditEventIds:Object.freeze([...r.itemAuditEventIds]),...r.schemaVersion===2?{assessmentAuditEventIds:Object.freeze([...assessments])}:{}})}) as QuoteCommitted;
}
export function parseQuoteDirectoryPage(v:unknown,request:{businessId:string;search:string;afterId:string|null;pageSize:number}){
 check(exact(v,['schemaVersion','businessId','quotes','hasMore'])&&v.schemaVersion===1&&v.businessId===request.businessId&&Array.isArray(v.quotes)&&v.quotes.length<=request.pageSize&&typeof v.hasMore==='boolean');let after=request.afterId;
 const quotes=v.quotes.map(entry=>{check(exact(entry,['family','revision']));const family=parseStoredQuoteFamily(entry.family,request.businessId),revision=parseStoredQuoteRevision(entry.revision,request.businessId,family.id);check((after===null||family.id>after)&&family.current_revision_id===revision.id&&revision.internal_snapshot.customerId===family.customer_id&&revision.internal_snapshot.leadId===family.lead_id);after=family.id;return Object.freeze({family,revision});});
 check(!v.hasMore||quotes.length===request.pageSize);return Object.freeze({schemaVersion:1 as const,businessId:request.businessId,quotes:Object.freeze(quotes),hasMore:v.hasMore});
}
export function parseQuoteHistoryPage(v:unknown,request:{businessId:string;familyId:string;revisionId:string;afterVersion:string;pageSize:number}){
 check(quoteId(request.businessId)&&quoteId(request.familyId)&&quoteId(request.revisionId)&&quoteVersion(request.afterVersion,true)&&Number.isSafeInteger(request.pageSize)&&request.pageSize>=1&&request.pageSize<=quoteHistoryPageLimit);
 if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(v,['schemaVersion','businessId','family','revision','items','history','hasMore'])&&v.schemaVersion===1&&v.businessId===request.businessId&&Array.isArray(v.items)&&Array.isArray(v.history)&&v.history.length<=request.pageSize&&typeof v.hasMore==='boolean');
 const family=parseStoredQuoteFamily(v.family,request.businessId),revision=parseStoredQuoteRevision(v.revision,request.businessId,family.id);check(family.id===request.familyId&&revision.id===request.revisionId&&family.current_revision_id===revision.id&&revision.internal_snapshot.customerId===family.customer_id&&revision.internal_snapshot.leadId===family.lead_id);
 const items=v.items.map(row=>parseStoredQuoteItem(row,request.businessId,revision.id)),active=items.filter(row=>row.active).sort((a,b)=>a.position!-b.position!);check(new Set(items.map(row=>row.id)).size===items.length&&new Set(items.map(row=>row.stable_line_key)).size===items.length&&active.length===revision.customer_safe_snapshot.lines.length);
 active.forEach((row,i)=>{const source=revision.internal_snapshot.sources[i];check(row.position===i+1&&sameData(row.customer_snapshot,revision.customer_safe_snapshot.lines[i])&&source!==undefined&&sameData({stableLineKey:row.stable_line_key,vehicleId:row.vehicle_id,jobWide:row.job_wide,serviceVersionId:row.service_version_id},{stableLineKey:source.stableLineKey,vehicleId:source.vehicleId,jobWide:source.jobWide,serviceVersionId:source.serviceVersionId}));if('assessment' in source)check(row.assessment_id===(source.assessment?.id??null)&&row.category_override_note===source.categoryOverrideNote);});
 let cursor=BigInt(request.afterVersion),last:StoredQuoteRevision|null=null;
 const history=v.history.map(event=>{
  check(exact(event,['eventId','revision','action','at','actorId','operationId','before','after'])&&quoteId(event.eventId)&&quoteVersion(event.revision)&&instant(event.at)&&quoteId(event.actorId)&&quoteId(event.operationId)&&['create','edit','submit','approve'].includes(event.action as string));
  const after=parseStoredQuoteRevision(event.after,request.businessId,family.id),before=event.before===null?null:parseStoredQuoteRevision(event.before,request.businessId,family.id);check(after.id===revision.id&&after.version===event.revision&&after.operation_id===event.operationId&&after.updated_by===event.actorId&&BigInt(event.revision)===cursor+1n&&BigInt(event.revision)<=BigInt(revision.version));
  if(before===null)check(event.revision==='1'&&event.action==='create'&&after.state==='Draft');else{
   check(before.id===after.id&&BigInt(before.version)+1n===BigInt(after.version)&&(['sequence','kind','created_at','created_by','origin','import_row_id'] as const).every(k=>before[k]===after[k]));
   if(event.action==='edit')check(after.state==='Draft'&&(before.customer_safe_snapshot.schemaVersion!==2||after.customer_safe_snapshot.schemaVersion===2)&&BigInt(after.content_version)===BigInt(before.content_version)+1n&&before.canonical_content!==after.canonical_content);
   else{check(['submit','approve'].includes(event.action as string)&&after.customer_safe_snapshot.schemaVersion===2&&after.state==='Ready for Review'&&after.content_version===before.content_version&&(['canonical_content','content_hash','total_cents','expiry_at','timezone'] as const).every(k=>before[k]===after[k])&&sameData(before.customer_safe_snapshot,after.customer_safe_snapshot)&&sameData(before.internal_snapshot,after.internal_snapshot));check(event.action==='submit'?before.state==='Draft':before.state==='Ready for Review');}
  }
  if(last!==null)check(before!==null&&sameData(last,before));last=after;cursor=BigInt(event.revision);return Object.freeze({eventId:event.eventId,revision:event.revision,action:event.action as 'create'|'edit'|'submit'|'approve',at:event.at,actorId:event.actorId,operationId:event.operationId,before,after});
 });
 const remaining=BigInt(revision.version)>BigInt(request.afterVersion)?BigInt(revision.version)-BigInt(request.afterVersion):0n,final=history.at(-1)?.after;check(BigInt(history.length)===(remaining>BigInt(request.pageSize)?BigInt(request.pageSize):remaining)&&v.hasMore===(remaining>BigInt(request.pageSize))&&(final===undefined||final.version!==revision.version||sameData(final,revision)));
 return Object.freeze({schemaVersion:1 as const,businessId:request.businessId,family,revision,items:Object.freeze(items),history:Object.freeze(history),hasMore:v.hasMore});
}
