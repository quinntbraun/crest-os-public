import {QuoteContentError} from '../commercial/quote-content';
import {prepareVersionedQuoteContent as prepareQuoteContent} from '../commercial/quote-review-content';
import type {VersionedQuoteContentInput as QuoteContentInput,QuoteAssessment,QuoteReviewLine} from '../commercial/quote-review-content';
import {quoteDollarsInput,quotePercentInput,QuotePricingError} from '../commercial/quote-pricing';
import type {QuoteDiscount} from '../commercial/quote-pricing';
import type {StoredQuoteRevision} from '../commercial/quote-storage-contract';
import {quoteInputFromSnapshots} from '../commercial/quote-storage-contract';
import type {CustomerAddress} from '../customer/customer-address-contract';

export type QuoteDiscountKind='none'|'fixed'|'percent';
export type QuoteObservationDraft=Readonly<{id:string;source:''|QuoteAssessment['source'];wall:string;instant:string;exact:string;notes:string}>;
export type QuoteLineDraft=Readonly<{id:string;scope:'unselected'|'job-wide'|'vehicle';vehicleId:string|null;vehicleLabel:string|null;serviceVersionId:string|null;description:string;inclusions:string;exclusions:string;condition:''|'Light'|'Moderate'|'Heavy'|'Extreme';amount:string;discountKind:QuoteDiscountKind;discount:string;discountEligible:boolean;complimentaryReason:string;category?:QuoteReviewLine['category'];assessment?:QuoteAssessment|null;assessmentDraft?:QuoteObservationDraft|undefined;categoryOverrideNote?:string|null}>;
export type QuoteDraft=Readonly<{contentSchemaVersion?:1|2;title:string;customerId:string|null;leadId:string|null;recipientName:string;phone:string;email:string;workLocation:string;terms:string;timezone:string;expiryAt:string;proposedSchedule:string;internalNotes:string;discountKind:QuoteDiscountKind;discount:string;lines:readonly QuoteLineDraft[]}>;
export const emptyQuoteDraft=(timezone:string):QuoteDraft=>Object.freeze({title:'',customerId:null,leadId:null,recipientName:'',phone:'',email:'',workLocation:'',terms:'',timezone,expiryAt:'',proposedSchedule:'',internalNotes:'',discountKind:'none',discount:'',lines:Object.freeze([])});
export const emptyQuoteLine=(id:string):QuoteLineDraft=>Object.freeze({id,scope:'unselected',vehicleId:null,vehicleLabel:null,serviceVersionId:null,description:'',inclusions:'',exclusions:'',condition:'',amount:'',discountKind:'none',discount:'',discountEligible:true,complimentaryReason:''});
const optional=(value:string)=>value.trim().length?value:null;
const dollars=(value:string)=>`${BigInt(value)/100n}.${(BigInt(value)%100n).toString().padStart(2,'0')}`;
function percentage(value:string){const [whole,fraction='']=value.split('.'),scaled=BigInt(whole!)*100000000n+BigInt(fraction.padEnd(8,'0')),decimal=(scaled%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return `${scaled/1000000n}${decimal?'.'+decimal:''}`;}
function discountInput(kind:QuoteDiscountKind,value:string):QuoteDiscount|null{return kind==='none'?null:kind==='fixed'?Object.freeze({kind:'fixed',cents:quoteDollarsInput(value)}):Object.freeze({kind:'percent',rate:quotePercentInput(value)});}
const discountDraft=(value:QuoteDiscount|null)=>value===null?{discountKind:'none' as const,discount:''}:value.kind==='fixed'?{discountKind:'fixed' as const,discount:dollars(value.cents)}:{discountKind:'percent' as const,discount:percentage(value.rate)};
export function copyQuoteDraft(draft:QuoteDraft):QuoteDraft{return Object.freeze({...draft,lines:Object.freeze(draft.lines.map(line=>Object.freeze({...line,...line.assessment?{assessment:Object.freeze({...line.assessment})}:{},...line.assessmentDraft?{assessmentDraft:Object.freeze({...line.assessmentDraft})}:{}})))});}
export function quoteLocationFromAddress(address:CustomerAddress):string{
 const written=[address.line1,address.line2,[address.city,address.region,address.postal_code].filter(value=>value!==null&&value.length>0).join(', '),address.country,address.exact_location_text].filter(value=>value!==null&&value.length>0).join('\n');
 if(written)return written;
 return address.latitude!==null&&address.longitude!==null?'Coordinates: '+address.latitude+', '+address.longitude:'';
}
export function parseQuoteDraft(draft:QuoteDraft):QuoteContentInput{
 if(draft.contentSchemaVersion!==2&&draft.lines.some(line=>line.assessmentDraft!==undefined||line.assessment!=null||line.category!=null||line.categoryOverrideNote!=null))throw new QuoteContentError('assessment');
 const content={schemaVersion:draft.contentSchemaVersion??1,title:draft.title,recipient:{customerId:draft.customerId,leadId:draft.leadId,displayName:draft.recipientName,phone:optional(draft.phone),email:optional(draft.email)},workLocation:draft.workLocation,terms:draft.terms,timezone:draft.timezone,expiryAt:optional(draft.expiryAt),proposedSchedule:optional(draft.proposedSchedule),internalNotes:optional(draft.internalNotes),documentDiscount:discountInput(draft.discountKind,draft.discount),lines:draft.lines.map(line=>{
  if(line.scope==='unselected')throw new QuoteContentError('scope');
  const observation=line.assessmentDraft,assessment=observation?(observation.source||observation.wall||observation.instant||observation.notes.trim()?{id:observation.id,class:line.condition,source:observation.source,assessedAt:observation.instant,notes:optional(observation.notes)}:null):line.assessment??null;
  return {id:line.id,vehicleId:line.scope==='vehicle'?line.vehicleId:null,jobWide:line.scope==='job-wide',vehicleLabel:line.scope==='vehicle'?line.vehicleLabel:null,serviceVersionId:line.serviceVersionId,description:line.description,inclusions:line.inclusions,exclusions:line.exclusions,condition:line.condition===''?null:line.condition,grossCents:quoteDollarsInput(line.amount),lineDiscount:discountInput(line.discountKind,line.discount),documentDiscountEligible:line.discountEligible,complimentaryReason:optional(line.complimentaryReason),...draft.contentSchemaVersion===2?{category:line.category??null,assessment,categoryOverrideNote:line.categoryOverrideNote===undefined||line.categoryOverrideNote===null?null:optional(line.categoryOverrideNote)}:{}};
 })};
 // Copy through the same strict content boundary used for server review.
 const prepared=prepareQuoteContent(content);return contentFromPrepared(prepared);
}
function contentFromPrepared(prepared:ReturnType<typeof prepareQuoteContent>):QuoteContentInput{
 return quoteInputFromSnapshots(prepared.customer,prepared.internal);
}
/** Explicit owner preparation only. Never invent category, observation source
 * or time when upgrading a historical draft for review. */
export function enableQuoteReviewDraft(draft:QuoteDraft):QuoteDraft{
 return draft.contentSchemaVersion===2?copyQuoteDraft(draft):copyQuoteDraft({...draft,contentSchemaVersion:2,lines:draft.lines.map(line=>({...line,category:null,assessment:null,categoryOverrideNote:null}))});
}
export function quoteDraftFromContent(input:QuoteContentInput):QuoteDraft{
 const content=contentFromPrepared(prepareQuoteContent(input));
 return copyQuoteDraft({...content.schemaVersion===2?{contentSchemaVersion:2 as const}:{},title:content.title,customerId:content.recipient.customerId,leadId:content.recipient.leadId,recipientName:content.recipient.displayName,phone:content.recipient.phone??'',email:content.recipient.email??'',workLocation:content.workLocation,terms:content.terms,timezone:content.timezone,expiryAt:content.expiryAt??'',proposedSchedule:content.proposedSchedule??'',internalNotes:content.internalNotes??'',...discountDraft(content.documentDiscount),lines:content.lines.map(line=>({id:line.id,scope:line.jobWide?'job-wide':'vehicle',vehicleId:line.vehicleId,vehicleLabel:line.vehicleLabel,serviceVersionId:line.serviceVersionId,description:line.description,inclusions:line.inclusions,exclusions:line.exclusions,condition:line.condition??'',amount:dollars(line.grossCents),...discountDraft(line.lineDiscount),discountEligible:line.documentDiscountEligible,complimentaryReason:line.complimentaryReason??'',...'category' in line?{category:line.category,assessment:line.assessment,categoryOverrideNote:line.categoryOverrideNote}:{}}))});
}
export function draftFromQuote(revision:StoredQuoteRevision):QuoteDraft{
 try{
  const content=quoteInputFromSnapshots(revision.customer_safe_snapshot,revision.internal_snapshot),prepared=prepareQuoteContent(content);
  if(prepared.canonical!==revision.canonical_content)throw Error();return quoteDraftFromContent(content);
 }catch{throw new QuoteContentError('stored');}
}
export function quoteDraftChanged(draft:QuoteDraft|null,original:QuoteDraft):boolean{if(draft===null)return false;try{return prepareQuoteContent(parseQuoteDraft(draft)).canonical!==prepareQuoteContent(parseQuoteDraft(original)).canonical;}catch{return JSON.stringify(draft)!==JSON.stringify(original);}}
export function quoteDraftIssue(draft:QuoteDraft):string{
 try{parseQuoteDraft(draft);return '';}catch(error){const code=error instanceof QuoteContentError||error instanceof QuotePricingError?error.code:'';
  const messages:Record<string,string>={recipient:'Choose a saved customer or lead and enter the recipient name.',scope:'Choose a saved vehicle or explicit job-wide scope for every line.',lines:'Add at least one scoped line.',line:'Describe each line and check its saved vehicle or service selection.',assessment:'Complete the entered condition observation, source and time, or clear its fields before saving. Vehicle assessment facts require the review content format.',amount:'Enter valid dollar amounts, with no more than two decimal places.',percentage:'Enter a percentage from 0 to 100, with no more than six decimal places.',discount_exceeds_amount:'A discount exceeds its line amount or eligible subtotal.',complimentary_reason:'Add a complimentary-work reason for each line reduced to zero.',total_overflow:'The total exceeds the supported exact cent range.',timezone:'Enter a valid named time zone.',content:'Enter a title, work location and valid optional expiry; check text lengths.'};return messages[code]??'Review the quote details before saving.';
 }
}
