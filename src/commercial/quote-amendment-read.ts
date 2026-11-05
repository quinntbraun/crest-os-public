// Private saved-amendment workspace. No write/acceptance authority; current
// parent/control observations must be rechecked by each trusted command.
import {customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion,quoteHistoryPageLimit,quoteResponseLimit,parseStoredQuoteFamily,parseStoredQuoteRevision,parseStoredQuoteAmendmentRevision,parseStoredQuoteItem,quoteAmendmentInputFromSnapshots} from './quote-storage-contract.ts';
import {parseQuoteReviewApproval} from './quote-review-contract.ts';
import {parseQuoteCancellationApproval} from './quote-cancellation-approval.ts';
import {prepareQuoteCancellationComparison} from './quote-cancellation-comparison.ts';
import {parseQuoteCommercialSend} from './quote-commercial-read.ts';
import {prepareQuoteAmendmentComparison} from './quote-amendment-comparison.ts';
import {QuoteAmendmentContractError} from './quote-amendment-contract.ts';
import {parseQuoteAmendmentAccept,quoteAmendmentAcceptReference} from './quote-amendment-acceptance-contract.ts';
import {bindQuoteAmendmentAcceptReceipt} from './quote-amendment-acceptance-receipt.ts';

function check(value:unknown):asserts value{if(!value)throw new QuoteAmendmentContractError();}
export type QuoteAmendmentReadRequest=Readonly<{businessId:string;familyId:string;revisionId:string;afterVersion:string;pageSize:number}>;
export function parseQuoteAmendmentReadRequest(value:unknown):QuoteAmendmentReadRequest{
 check(exact(value,['businessId','familyId','revisionId','afterVersion','pageSize'])&&quoteId(value.businessId)&&quoteId(value.familyId)&&quoteId(value.revisionId)&&quoteVersion(value.afterVersion,true)&&Number.isSafeInteger(value.pageSize)&&Number(value.pageSize)>=1&&Number(value.pageSize)<=quoteHistoryPageLimit);return Object.freeze({...value}) as QuoteAmendmentReadRequest;
}
function same(a:unknown,b:unknown):boolean{if(a===b)return true;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x);return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));}
const instant=(v:unknown):v is string=>typeof v==='string'&&v.length===27&&customerInstant(v);
async function fingerprint(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');}
const revisionKeys=['state','version','updated_at','updated_by','operation_id'];
function retained(before:Record<string,unknown>,after:Record<string,unknown>,except:readonly string[]){return same(Object.fromEntries(Object.entries(before).filter(([k])=>!except.includes(k))),Object.fromEntries(Object.entries(after).filter(([k])=>!except.includes(k))));}
/** Shared parent/control observations for the selector and saved workspace.
 * The parent can be historical; only a trusted command decides write eligibility. */
export function parseQuoteAmendmentParent(raw:unknown,controlValue:unknown,family:ReturnType<typeof parseStoredQuoteFamily>){
 check(exact(raw,['agreementId','acceptanceId','versionNo','customerId','sourceLeadId','revision'])&&quoteId(raw.agreementId)&&quoteId(raw.acceptanceId)&&quoteVersion(raw.versionNo)&&quoteId(raw.customerId)&&raw.sourceLeadId===family.lead_id);
 check(raw.revision!==null&&typeof raw.revision==='object'&&!Array.isArray(raw.revision));
 const parentRevision=Object.hasOwn(raw.revision,'parent_agreement_id')?parseStoredQuoteAmendmentRevision(raw.revision,family.business_id,family.id):parseStoredQuoteRevision(raw.revision,family.business_id,family.id);
 check(parentRevision.state==='Accepted'&&(raw.versionNo==='1')===(parentRevision.kind==='initial')&&(family.customer_id===null?family.lead_id!==null:family.customer_id===raw.customerId));
 check(parentRevision.internal_snapshot.leadId===family.lead_id&&(parentRevision.internal_snapshot.customerId===null?family.lead_id!==null:parentRevision.internal_snapshot.customerId===raw.customerId));
 const c=controlValue;check(exact(c,['version','activeOfferId','initialAcceptanceId','currentAgreementId'])&&quoteVersion(c.version)&&(c.activeOfferId===null||quoteId(c.activeOfferId))&&quoteId(c.initialAcceptanceId)&&quoteId(c.currentAgreementId)&&(raw.versionNo!=='1'||raw.acceptanceId===c.initialAcceptanceId));
 const parent=Object.freeze({agreementId:raw.agreementId,acceptanceId:raw.acceptanceId,versionNo:raw.versionNo,customerId:raw.customerId,sourceLeadId:family.lead_id,revision:parentRevision}),control=Object.freeze({...c}) as Readonly<{version:string;activeOfferId:string|null;initialAcceptanceId:string;currentAgreementId:string}>;
 return Object.freeze({parent,control});
}
export async function parseQuoteAmendmentRead(value:unknown,input:QuoteAmendmentReadRequest){
 try{
  const request=parseQuoteAmendmentReadRequest(input);
  if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
  check(value!==null&&typeof value==='object'&&!Array.isArray(value));const raw=value as Record<string,unknown>,accepted=raw.schemaVersion===2;
  check(exact(value,['schemaVersion','businessId','family','revision','parent','control','items','approval','latestSend','history','hasMore',...(accepted?['acceptance']:[])])&&(value.schemaVersion===1||accepted)&&value.businessId===request.businessId&&typeof value.hasMore==='boolean');
  const family=parseStoredQuoteFamily(value.family,request.businessId),revision=parseStoredQuoteAmendmentRevision(value.revision,request.businessId,request.familyId);
  const cancellation=revision.customer_safe_snapshot.schemaVersion===3;
  // Accepted cancellation requires the same exact saved customer confirmation
  // and independently reconstructed original as every other accepted amendment.
  if(cancellation)check(['Draft','Ready for Review','Sent','Superseded','Accepted'].includes(revision.state));
  check(family.id===request.familyId&&revision.id===request.revisionId&&['Draft','Ready for Review','Sent','Superseded','Accepted'].includes(revision.state));
  const {parent,control}=parseQuoteAmendmentParent(value.parent,value.control,family),parentRevision=parent.revision;
  check(parent.agreementId===revision.parent_agreement_id&&parentRevision.id!==revision.id&&revision.internal_snapshot.customerId===parent.customerId&&revision.internal_snapshot.leadId===family.lead_id);
  const approval=value.approval===null?null:cancellation?parseQuoteCancellationApproval(value.approval,revision):parseQuoteReviewApproval(value.approval,{contentVersion:revision.content_version,contentHash:revision.content_hash});
  const latestSend=parseQuoteCommercialSend(value.latestSend,revision.id,approval);
  if(cancellation&&latestSend)check(approval&&approval.reviewedAt.length===27&&latestSend.confirmedAt>=approval.reviewedAt);
  if(revision.state==='Draft')check(approval===null&&latestSend===null);
  if(revision.state==='Ready for Review')check(latestSend===null);
  if(revision.state==='Sent')check(approval&&latestSend&&control.activeOfferId===revision.id);
  if(revision.state==='Superseded')check(approval&&latestSend&&control.activeOfferId!==revision.id);
  check(accepted===(revision.state==='Accepted'));
  let acceptance:Readonly<{request:ReturnType<typeof parseQuoteAmendmentAccept>;original:ReturnType<typeof bindQuoteAmendmentAcceptReceipt>;recordedAt:string}>|null=null;
  if(accepted){
   check(approval&&latestSend&&control.activeOfferId!==revision.id&&control.currentAgreementId!==parent.agreementId&&exact(value.acceptance,['request','original','recordedAt'])&&instant(value.acceptance.recordedAt));const q=parseQuoteAmendmentAccept(value.acceptance.request),original=bindQuoteAmendmentAcceptReceipt(value.acceptance.original,request.businessId,quoteAmendmentAcceptReference(q),q);
   check(q.operationId===revision.operation_id&&q.familyId===family.id&&q.revisionId===revision.id&&original.receipt.revisionVersion===revision.version&&q.expectedContentVersion===revision.content_version&&q.expectedHash===revision.content_hash&&q.expectedParentAgreementId===parent.agreementId&&q.expectedParentAgreementVersion===parent.versionNo&&q.expectedParentAcceptedHash===parentRevision.content_hash&&q.body.customerId===parent.customerId&&q.body.sendId===latestSend.id&&original.receipt.approvalId===approval.id&&q.body.confirmationEffectiveAt>=approval.reviewedAt&&q.body.confirmationEffectiveAt<=value.acceptance.recordedAt&&q.scopePlans.reduce((n,p)=>n+BigInt(p.amountCents),0n)===BigInt(revision.total_cents));
   if(cancellation)check(q.scopePlans.length>0&&q.scopePlans.every(plan=>plan.authorizationState==='withdrawn'));
   acceptance=Object.freeze({request:q,original,recordedAt:value.acceptance.recordedAt});
  }
  check(Array.isArray(value.items)&&value.items.length===revision.customer_safe_snapshot.lines.length);
  const items=value.items.map((item,index)=>{const parsed=parseStoredQuoteItem(item,request.businessId,request.revisionId),source=revision.internal_snapshot.sources[index],line=revision.customer_safe_snapshot.lines[index];check(source&&line&&'assessment' in source&&'categoryOverrideNote' in source&&parsed.active&&parsed.position===index+1&&parsed.stable_line_key===source.stableLineKey&&parsed.vehicle_id===source.vehicleId&&parsed.job_wide===source.jobWide&&parsed.service_version_id===source.serviceVersionId&&same(parsed.customer_snapshot,line)&&parsed.assessment_id===(source.assessment?.id??null)&&parsed.category_override_note===source.categoryOverrideNote);return parsed;});
  for(const key of ['id','stable_line_key'] as const)check(new Set(items.map(v=>v[key])).size===items.length);
  check(Array.isArray(value.history)&&value.history.length<=request.pageSize);let previous:ReturnType<typeof parseStoredQuoteAmendmentRevision>|null=null,cursor=BigInt(request.afterVersion);const eventIds=new Set<string>();
  const history=value.history.map(event=>{
   check(exact(event,['eventId','revision','action','at','actorId','operationId','before','after'])&&quoteId(event.eventId)&&!eventIds.has(event.eventId)&&quoteVersion(event.revision)&&BigInt(event.revision)===cursor+1n&&instant(event.at)&&quoteId(event.actorId)&&quoteId(event.operationId)&&['create','edit','submit','approve','send','accept'].includes(event.action as string));eventIds.add(event.eventId);
   const before=event.before===null?null:parseStoredQuoteAmendmentRevision(event.before,request.businessId,request.familyId),after=parseStoredQuoteAmendmentRevision(event.after,request.businessId,request.familyId);
   check(after.id===revision.id&&after.parent_agreement_id===parent.agreementId&&after.version===event.revision&&after.updated_by===event.actorId&&after.operation_id===event.operationId);
   if(before===null)check(event.revision==='1'&&event.action==='create'&&after.state==='Draft'&&after.content_version==='1');
   else{
    check(before.id===after.id&&before.parent_agreement_id===after.parent_agreement_id&&BigInt(before.version)+1n===BigInt(after.version)&&BigInt(before.version)===cursor);
    if(event.action==='edit')check(['Draft','Ready for Review'].includes(before.state)&&after.state==='Draft'&&BigInt(after.content_version)===BigInt(before.content_version)+1n&&before.canonical_content!==after.canonical_content&&retained(before,after,[...revisionKeys,'content_version','customer_safe_snapshot','internal_snapshot','canonical_content','content_hash','total_cents','expiry_at','timezone','tax_readiness']));
    else{check(before.content_version===after.content_version&&retained(before,after,revisionKeys));check(event.action==='submit'?before.state==='Draft'&&after.state==='Ready for Review':event.action==='approve'?before.state==='Ready for Review'&&after.state==='Ready for Review':event.action==='accept'?before.state==='Sent'&&after.state==='Accepted':event.action==='send'&&(before.state==='Ready for Review'&&after.state==='Sent'||before.state==='Sent'&&['Sent','Superseded'].includes(after.state)));}
   }
   if(previous!==null)check(before!==null&&same(previous,before));previous=after;cursor=BigInt(event.revision);return Object.freeze({eventId:event.eventId,revision:event.revision,action:event.action as 'create'|'edit'|'submit'|'approve'|'send'|'accept',at:event.at,actorId:event.actorId,operationId:event.operationId,before,after});
  });
  const remaining=BigInt(revision.version)>BigInt(request.afterVersion)?BigInt(revision.version)-BigInt(request.afterVersion):0n;const final=history.at(-1)?.after;check(BigInt(history.length)===(remaining>BigInt(request.pageSize)?BigInt(request.pageSize):remaining)&&value.hasMore===(remaining>BigInt(request.pageSize))&&(final===undefined||final.version!==revision.version||same(final,revision)));
  // All bindings and snapshots above are sealed before hashing yields.
  check(await fingerprint(revision.canonical_content)===revision.content_hash&&await fingerprint(parentRevision.canonical_content)===parentRevision.content_hash);
  if(approval)check(await fingerprint(approval.presentationText)===approval.presentationHash&&same(approval.customerRepresentation,revision.customer_safe_snapshot));
  const comparisonInput={schemaVersion:1,businessId:request.businessId,familyId:request.familyId,parent:{agreementId:parent.agreementId,versionNo:parent.versionNo,revisionId:parentRevision.id,contentHash:parentRevision.content_hash,customerId:parent.customerId,sourceLeadId:parent.sourceLeadId,content:quoteAmendmentInputFromSnapshots(parentRevision.customer_safe_snapshot,parentRevision.internal_snapshot)},proposedContent:quoteAmendmentInputFromSnapshots(revision.customer_safe_snapshot,revision.internal_snapshot)};
  const comparison=await(cancellation?prepareQuoteCancellationComparison(comparisonInput):prepareQuoteAmendmentComparison(comparisonInput));
  const common={businessId:request.businessId,family,revision,parent,control,parentIsCurrent:control.currentAgreementId===parent.agreementId,items:Object.freeze(items),approval,latestSend,history:Object.freeze(history),hasMore:value.hasMore,comparison};const result=Object.freeze(acceptance?{...common,schemaVersion:2 as const,acceptance}:{...common,schemaVersion:1 as const});check(new TextEncoder().encode(JSON.stringify(result)).length<=quoteResponseLimit);return result;
 }catch{throw new QuoteAmendmentContractError();}
}
export type QuoteAmendmentRead=Awaited<ReturnType<typeof parseQuoteAmendmentRead>>;
// Derived comparison/current-parent observations are recomputed by the browser
// from the exact private source packet, never accepted as caller authority.
export function quoteAmendmentReadToWire(value:QuoteAmendmentRead){
 if('state'in value)return Object.freeze({state:'absent' as const});
 return Object.freeze({schemaVersion:value.schemaVersion,businessId:value.businessId,family:value.family,revision:value.revision,parent:value.parent,control:value.control,items:value.items,approval:value.approval,latestSend:value.latestSend,history:value.history,hasMore:value.hasMore,...(value.schemaVersion===2?{acceptance:value.acceptance}:{})});
}
