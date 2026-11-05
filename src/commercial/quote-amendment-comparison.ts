// BR05/P05 construction: exact amendment preparation, never save/accept authority.
// Current parent, approval, customer, remaining allocations and financial limits
// still require the trusted transaction under the existing shared locks.
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion,quoteResponseLimit} from './quote-storage-contract.ts';
import {quoteReviewHash} from './quote-review-contract.ts';
import {prepareVersionedQuoteContent,prepareQuoteAmendmentContent} from './quote-review-content.ts';

type Prepared=ReturnType<typeof prepareVersionedQuoteContent>;
type Line=Prepared['customer']['lines'][number];
export class QuoteAmendmentComparisonError extends Error{
 readonly code:'input'|'parent'|'customer'|'scope_identity'|'budget'|'reconciliation';
 constructor(code:QuoteAmendmentComparisonError['code']){super('QUOTE_AMENDMENT_REVIEW_REQUIRED');this.name='QuoteAmendmentComparisonError';this.code=code;}
}
const fail=(code:QuoteAmendmentComparisonError['code']):never=>{throw new QuoteAmendmentComparisonError(code);};
const headerFields=['title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','documentDiscount'] as const;
const lineFields=['description','inclusions','exclusions','vehicle','condition','category','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason'] as const;
const parentFields=['agreementId','versionNo','revisionId','contentHash','customerId','sourceLeadId','content'] as const;
async function fingerprint(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function prepared(value:unknown){try{const result=prepareVersionedQuoteContent(value);if(new TextEncoder().encode(result.canonical).length>quoteResponseLimit)return fail('budget');return result;}catch(error){if(error instanceof QuoteAmendmentComparisonError)throw error;return fail('input');}}
function comparable(line:Line){return JSON.stringify(lineFields.map(field=>field==='category'&&!('category'in line)?null:(line as unknown as Record<string,unknown>)[field]));}
type ChangeKind='added'|'removed'|'changed'|'moved';
type CustomerChange=Readonly<{kind:ChangeKind;beforePosition:number|null;afterPosition:number|null;before:Line|null;after:Line|null}>;
type SourceChange=Readonly<{stableLineKey:string;kind:ChangeKind;beforePosition:number|null;afterPosition:number|null;previousCents:string;revisedCents:string;signedDeltaCents:string}>;

export async function prepareQuoteAmendmentComparison(value:unknown){
 if(!exact(value,['schemaVersion','businessId','familyId','parent','proposedContent'])||value.schemaVersion!==1||!quoteId(value.businessId)||!quoteId(value.familyId)||!exact(value.parent,parentFields))return fail('input');
 // Seal primitive bindings before hashing yields; a later draft edit cannot
 // rebind this comparison to another parent, customer or business.
 const parent=Object.freeze({...value.parent}),businessId=value.businessId,familyId=value.familyId;
 if(!quoteId(parent.agreementId)||!quoteVersion(parent.versionNo)||!quoteVersion((BigInt(parent.versionNo)+1n).toString())||!quoteId(parent.revisionId)||!quoteId(parent.customerId)||!quoteReviewHash(parent.contentHash)||parent.sourceLeadId!==null&&!quoteId(parent.sourceLeadId))return fail('parent');
 const cancellationParent=parent.content&&typeof parent.content==='object'&&'schemaVersion'in parent.content&&parent.content.schemaVersion===3;
 let before:ReturnType<typeof prepareVersionedQuoteContent>|ReturnType<typeof prepareQuoteAmendmentContent>;try{before=cancellationParent?prepareQuoteAmendmentContent(parent.content):prepared(parent.content);}catch(error){if(error instanceof QuoteAmendmentComparisonError)throw error;return fail('input');}
 if(new TextEncoder().encode(before.canonical).length>quoteResponseLimit)return fail('budget');
 const after=prepared(value.proposedContent);
 if(await fingerprint(before.canonical)!==parent.contentHash)return fail('parent');
 if(before.internal.leadId!==parent.sourceLeadId||(before.internal.customerId!==null?before.internal.customerId!==parent.customerId:before.internal.leadId===null))return fail('customer');
 if(after.internal.customerId!==parent.customerId||after.internal.leadId!==null&&after.internal.leadId!==parent.sourceLeadId)return fail('customer');
 const oldLines=new Map(before.internal.sources.map((source,index)=>[source.stableLineKey,{source,index,line:before.customer.lines[index]!}])),newLines=new Map(after.internal.sources.map((source,index)=>[source.stableLineKey,{source,index,line:after.customer.lines[index]!}]));
 const customerChanges:CustomerChange[]=[],sourceChanges:SourceChange[]=[];
 for(const key of [...newLines.keys(),...[...oldLines.keys()].filter(key=>!newLines.has(key))]){
  const old=oldLines.get(key),next=newLines.get(key);
  // An entitlement's vehicle/job-wide dimension is immutable. A replacement
  // scope needs its own identity; the old identity cannot silently move cars.
  if(old&&next&&(old.source.vehicleId!==next.source.vehicleId||old.source.jobWide!==next.source.jobWide))return fail('scope_identity');
  const kind:ChangeKind|null=!old?'added':!next?'removed':comparable(old.line)!==comparable(next.line)?'changed':old.index!==next.index?'moved':null;
  if(!kind)continue;
  const beforePosition=old?old.index+1:null,afterPosition=next?next.index+1:null,previousCents=old?.line.finalCents??'0',revisedCents=next?.line.finalCents??'0';
  customerChanges.push(Object.freeze({kind,beforePosition,afterPosition,before:old?.line??null,after:next?.line??null}));
  sourceChanges.push(Object.freeze({stableLineKey:key,kind,beforePosition,afterPosition,previousCents,revisedCents,signedDeltaCents:(BigInt(revisedCents)-BigInt(previousCents)).toString()}));
 }
 const signedDeltaCents=(BigInt(after.customer.totalCents)-BigInt(before.customer.totalCents)).toString();
 if(sourceChanges.reduce((sum,line)=>sum+BigInt(line.signedDeltaCents),0n)!==BigInt(signedDeltaCents))return fail('reconciliation');
 const headerChanges:({readonly field:typeof headerFields[number];readonly before:unknown;readonly after:unknown}|{readonly field:'cancellationReason';readonly before:string;readonly after:null})[]=headerFields.filter(field=>JSON.stringify(before.customer[field])!==JSON.stringify(after.customer[field])).map(field=>Object.freeze({field,before:before.customer[field],after:after.customer[field]}));
 if(before.customer.schemaVersion===3)headerChanges.push(Object.freeze({field:'cancellationReason' as const,before:before.customer.cancellationReason,after:null}));
 const customer=Object.freeze({schemaVersion:1 as const,currency:'USD' as const,previousAgreementVersion:parent.versionNo,proposedAgreementVersion:(BigInt(parent.versionNo)+1n).toString(),previousTotalCents:before.customer.totalCents,revisedTotalCents:after.customer.totalCents,signedDeltaCents,headerChanges:Object.freeze(headerChanges),lineChanges:Object.freeze(customerChanges)});
 const internal=Object.freeze({businessId,familyId,parentAgreementId:parent.agreementId,parentAgreementVersion:parent.versionNo,parentRevisionId:parent.revisionId,expectedAcceptedHash:parent.contentHash,customerId:parent.customerId,proposedContentHash:await fingerprint(after.canonical),lineChanges:Object.freeze(sourceChanges)});
 // Customer rendering must choose this explicit safe projection, as with the
 // existing quote serializer. Internal notes/assessment/source IDs stay out.
 const result=Object.freeze({customer,internal,hasCustomerChanges:headerChanges.length>0||customerChanges.length>0});
 if(new TextEncoder().encode(JSON.stringify(result)).length>quoteResponseLimit)return fail('budget');
 return result;
}
export type QuoteAmendmentCustomerComparison=Awaited<ReturnType<typeof prepareQuoteAmendmentComparison>>['customer'];
